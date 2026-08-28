/**
 * The opcodes this bot uses. Values are the WoW 1.12 (build 5875) protocol.
 *
 * Auth-server commands are a single byte. World opcodes are 2 bytes on the wire
 * inbound (SMSG) and 4 bytes outbound (CMSG); the numeric value is the same.
 */

export enum AuthCommand {
  LogonChallenge = 0x00,
  LogonProof = 0x01,
  RealmList = 0x10,
}

/** Auth-server logon result codes (CMD_AUTH_LOGON_CHALLENGE_Server.result). */
export enum LogonResult {
  Success = 0x00,
  UnknownAccount = 0x04,
  IncorrectPassword = 0x05,
  Banned = 0x03,
  AlreadyOnline = 0x06,
  Suspended = 0x0c,
  VersionInvalid = 0x09,
}

export enum WorldOpcode {
  CMSG_CHAR_ENUM = 0x37,
  SMSG_CHAR_ENUM = 0x3b,
  CMSG_PLAYER_LOGIN = 0x3d,
  CMSG_LOGOUT_REQUEST = 0x4b,
  CMSG_WHO = 0x62,
  SMSG_WHO = 0x63,
  CMSG_PING = 0x1dc,
  SMSG_PONG = 0x1dd,
  SMSG_AUTH_CHALLENGE = 0x1ec,
  CMSG_AUTH_SESSION = 0x1ed,
  SMSG_AUTH_RESPONSE = 0x1ee,
  SMSG_LOGIN_VERIFY_WORLD = 0x236,
  SMSG_WARDEN_DATA = 0x2e6,
  CMSG_WARDEN_DATA = 0x2e7,
}

/** SMSG_AUTH_RESPONSE result byte we treat as "you are in". */
export const AUTH_OK = 0x0c;

/**
 * Client build advertised at logon. OctoWoW's custom client reports 7272 (stock
 * 1.12.1 is 5875), and its server keys the integrity check on this build — the
 * challenge accepts 5875 but the version check does not.
 */
export const CLIENT_BUILD = 7272;
export const CLIENT_VERSION = { major: 1, minor: 12, patch: 1 } as const;
