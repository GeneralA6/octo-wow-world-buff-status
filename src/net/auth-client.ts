import { connect, type Socket } from "node:net";
import { computeSrp6Proof } from "../crypto/srp6.js";
import { FatalError } from "../errors.js";
import { LogonResult } from "../protocol/opcodes.js";
import { createLogger, type Logger } from "../logger.js";
import {
  buildLogonChallenge,
  buildLogonProof,
  buildRealmListRequest,
  parseLogonChallengeServer,
  parseLogonProofServer,
  parseRealmList,
  type RealmEntry,
} from "./auth-packets.js";

export interface AuthCredentials {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password: string;
}

export interface AuthResult {
  /** 40-byte SRP6 session key for the world handshake. */
  readonly sessionKey: Buffer;
  readonly realms: readonly RealmEntry[];
}

const LOGON_RESULT_MESSAGE: Partial<Record<number, string>> = {
  [LogonResult.UnknownAccount]: "unknown account",
  [LogonResult.IncorrectPassword]: "incorrect password",
  [LogonResult.Banned]: "account banned",
  [LogonResult.AlreadyOnline]: "account already online",
  [LogonResult.Suspended]: "account suspended",
  [LogonResult.VersionInvalid]: "client version rejected",
};

function describeLogonResult(result: number): string {
  return LOGON_RESULT_MESSAGE[result] ?? `logon failed (code 0x${result.toString(16)})`;
}

/**
 * Performs the SRP6 logon handshake against the auth server and fetches the realm
 * list. The auth server sends one response per request with no length framing, so
 * each step accumulates bytes and parses the whole buffer once it is complete
 * (a RangeError from the parser means "need more bytes").
 */
export class AuthClient {
  readonly #logger: Logger;

  constructor(logger: Logger = createLogger()) {
    this.#logger = logger;
  }

  async login(credentials: AuthCredentials, timeoutMs = 15_000): Promise<AuthResult> {
    const socket = connect({ host: credentials.host, port: credentials.port });
    socket.setTimeout(timeoutMs);

    try {
      await once(socket, "connect", timeoutMs);
      this.#logger.debug(`auth: connected to ${credentials.host}:${credentials.port}`);

      socket.write(buildLogonChallenge(credentials.username));
      const challenge = parseLogonChallengeServer(await readMessage(socket, parseLogonChallengeServer));
      if (
        challenge.result !== LogonResult.Success ||
        !challenge.serverPublicKey ||
        !challenge.generator ||
        !challenge.largeSafePrime ||
        !challenge.salt
      ) {
        throw new FatalError(`auth: ${describeLogonResult(challenge.result)}`);
      }

      const proof = computeSrp6Proof({
        username: credentials.username,
        password: credentials.password,
        serverPublicKey: challenge.serverPublicKey,
        generator: challenge.generator,
        largeSafePrime: challenge.largeSafePrime,
        salt: challenge.salt,
      });

      socket.write(buildLogonProof(proof.clientPublicKey, proof.clientProof));
      const proofResult = parseLogonProofServer(await readMessage(socket, parseLogonProofServer));
      if (proofResult.result !== LogonResult.Success || !proofResult.serverProof) {
        throw new FatalError(`auth: ${describeLogonResult(proofResult.result)}`);
      }
      if (!proofResult.serverProof.equals(proof.expectedServerProof)) {
        throw new FatalError("auth: server proof mismatch (wrong password or spoofed server)");
      }
      this.#logger.debug("auth: SRP6 proof accepted");

      socket.write(buildRealmListRequest());
      const realms = parseRealmList(await readRealmListPayload(socket));
      this.#logger.debug(`auth: ${realms.length} realm(s) returned`);

      return { sessionKey: proof.sessionKey, realms };
    } finally {
      socket.destroy();
    }
  }
}

/** Resolve once `event` fires, or reject on timeout/error/close. */
function once(socket: Socket, event: "connect", timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`timed out waiting for ${event}`)), timeoutMs);
    const finish = (error?: Error): void => {
      clearTimeout(timer);
      socket.off(event, onEvent);
      socket.off("error", onError);
      if (error) reject(error);
      else resolve();
    };
    const onEvent = (): void => finish();
    const onError = (error: Error): void => finish(error);
    socket.once(event, onEvent);
    socket.once("error", onError);
  });
}

/**
 * Accumulate bytes until `parse` succeeds, then resolve the whole buffer. Used
 * for the fixed-shape challenge/proof responses; the parser throwing RangeError
 * means the message is not fully arrived yet.
 */
function readMessage<T>(socket: Socket, parse: (buf: Buffer) => T): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let acc = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      acc = Buffer.concat([acc, chunk]);
      try {
        parse(acc);
      } catch (error) {
        if (error instanceof RangeError) return; // need more bytes
        finish(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      finish(undefined, acc);
    };
    const onError = (error: Error): void => finish(error);
    const onClose = (): void => finish(new Error("auth connection closed early"));
    const onTimeout = (): void => finish(new Error("auth connection timed out"));
    const finish = (error?: Error, value?: Buffer): void => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
      socket.off("timeout", onTimeout);
      if (error) reject(error);
      else if (value) resolve(value);
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
    socket.once("timeout", onTimeout);
  });
}

/** The realm-list response is [opcode u8][u16 size][payload]; return the payload. */
async function readRealmListPayload(socket: Socket): Promise<Buffer> {
  const full = await readMessage(socket, (buf) => {
    if (buf.length < 3) throw new RangeError("need header");
    const size = buf.readUInt16LE(1);
    if (buf.length < 3 + size) throw new RangeError("need body");
    return true;
  });
  return full.subarray(3);
}
