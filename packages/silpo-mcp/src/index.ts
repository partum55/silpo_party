import { randomBytes, timingSafeEqual } from "node:crypto";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  auth,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  UnauthorizedError,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { createClient } from "@supabase/supabase-js";

import { decryptJson, encryptJson } from "./crypto.ts";

export { decryptJson, encryptJson } from "./crypto.ts";

const SILPO_MCP_URL = new URL("https://mcp.silpo.ua/mcp");

type SilpoData = {
  clientInformation?: OAuthClientInformationMixed;
  codeVerifier?: string;
  discoveryState?: OAuthDiscoveryState;
  oauthState?: string;
  redirectUrl?: string;
  tokens?: OAuthTokens;
};

type SilpoConnection = { connectedAt: string | null; data: SilpoData };

export function hasUsableTokens(tokens?: Partial<OAuthTokens>) {
  return Boolean(tokens?.access_token || tokens?.refresh_token);
}

export function verifyOAuthState(expected: string | undefined, actual: string | null) {
  const left = Buffer.from(expected ?? "");
  const right = Buffer.from(actual ?? "");
  if (!left.length || left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new Error("Invalid OAuth state");
  }
}

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export function createSupabaseAdminClient() {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function saveConnection(userId: string, connection: SilpoConnection) {
  const { error } = await createSupabaseAdminClient().from("silpo_connections").upsert({
    user_id: userId,
    credentials: encryptJson(connection.data, env("SILPO_CREDENTIALS_KEY")),
    connected_at: connection.connectedAt,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function getSilpoConnection(userId: string): Promise<SilpoConnection | null> {
  const { data, error } = await createSupabaseAdminClient()
    .from("silpo_connections")
    .select("credentials, connected_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    connectedAt: data.connected_at,
    data: decryptJson<SilpoData>(data.credentials, env("SILPO_CREDENTIALS_KEY")),
  };
}

export async function isSilpoConnected(userId: string) {
  const { data, error } = await createSupabaseAdminClient()
    .from("silpo_connections")
    .select("connected_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.connected_at);
}

class SilpoOAuthProvider implements OAuthClientProvider {
  authorizationUrl?: URL;
  private readonly userId: string;
  private connection: SilpoConnection;

  constructor(userId: string, connection: SilpoConnection) {
    this.userId = userId;
    this.connection = connection;
  }

  get redirectUrl() { return this.connection.data.redirectUrl; }
  get clientMetadata(): OAuthClientMetadata {
    if (!this.redirectUrl) throw new Error("Missing Silpo OAuth redirect URL");
    return {
      client_name: "Silpo Party",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    };
  }
  state() {
    if (!this.connection.data.oauthState) throw new Error("Missing Silpo OAuth state");
    return this.connection.data.oauthState;
  }
  clientInformation() { return this.connection.data.clientInformation; }
  async saveClientInformation(clientInformation: OAuthClientInformationMixed) { await this.update({ clientInformation }); }
  tokens() { return this.connection.data.tokens; }
  async saveTokens(tokens: OAuthTokens) { await this.update({ tokens }); }
  redirectToAuthorization(url: URL) { this.authorizationUrl = url; }
  async saveCodeVerifier(codeVerifier: string) { await this.update({ codeVerifier }); }
  codeVerifier() {
    if (!this.connection.data.codeVerifier) throw new Error("Missing PKCE verifier");
    return this.connection.data.codeVerifier;
  }
  discoveryState() { return this.connection.data.discoveryState; }
  async saveDiscoveryState(discoveryState: OAuthDiscoveryState) { await this.update({ discoveryState }); }
  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    const latest = await getSilpoConnection(this.userId);
    if (latest?.data.tokens?.refresh_token && latest.data.tokens.refresh_token !== this.connection.data.tokens?.refresh_token) {
      this.connection = latest;
      return;
    }
    if (scope === "all" || scope === "client") delete this.connection.data.clientInformation;
    if (scope === "all" || scope === "tokens") delete this.connection.data.tokens;
    if (scope === "all" || scope === "verifier") delete this.connection.data.codeVerifier;
    if (scope === "all" || scope === "discovery") delete this.connection.data.discoveryState;
    this.connection.connectedAt = null;
    await saveConnection(this.userId, this.connection);
  }
  private async update(patch: Partial<SilpoData>) {
    Object.assign(this.connection.data, patch);
    await saveConnection(this.userId, this.connection);
  }
}

export async function startSilpoAuthorization(userId: string, callbackUrl: string) {
  const existing = await getSilpoConnection(userId);
  const connection: SilpoConnection = {
    connectedAt: null,
    data: {
      clientInformation: existing?.data.clientInformation,
      discoveryState: existing?.data.discoveryState,
      oauthState: randomBytes(32).toString("base64url"),
      redirectUrl: callbackUrl,
    },
  };
  await saveConnection(userId, connection);
  const provider = new SilpoOAuthProvider(userId, connection);
  const result = await auth(provider, { serverUrl: SILPO_MCP_URL });
  if (result !== "REDIRECT" || !provider.authorizationUrl) throw new Error("Silpo OAuth did not return an authorization URL");
  return provider.authorizationUrl;
}

export async function finishSilpoAuthorization(userId: string, code: string, state: string | null) {
  const connection = await getSilpoConnection(userId);
  if (!connection) throw new Error("Silpo OAuth flow was not started");
  verifyOAuthState(connection.data.oauthState, state);

  const provider = new SilpoOAuthProvider(userId, connection);
  const transport = new StreamableHTTPClientTransport(SILPO_MCP_URL, { authProvider: provider });
  await transport.finishAuth(code);
  const client = new Client({ name: "silpo-party", version: "0.1.0" });
  try {
    await client.connect(transport);
    await client.callTool({ name: "silpo_get_my_profile", arguments: {} });
    connection.connectedAt = new Date().toISOString();
    delete connection.data.codeVerifier;
    delete connection.data.oauthState;
    await saveConnection(userId, connection);
  } finally {
    await client.close();
  }
}

export async function getAuthenticatedSilpoMcpClient(userId: string) {
  const connection = await getSilpoConnection(userId);
  if (!connection?.connectedAt || !hasUsableTokens(connection.data.tokens)) {
    throw new SilpoReconnectRequiredError();
  }
  const provider = new SilpoOAuthProvider(userId, connection);
  const client = new Client({ name: "silpo-party", version: "0.1.0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(SILPO_MCP_URL, { authProvider: provider }));
    return client;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      await provider.invalidateCredentials("tokens");
      throw new SilpoReconnectRequiredError();
    }
    throw error;
  }
}

export class SilpoReconnectRequiredError extends Error {
  constructor() { super("Silpo connection must be renewed"); }
}
