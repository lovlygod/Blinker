import type { DistributiveOmit } from "./utils";
import type { PasswordSaveCandidate } from "./passwords";

// Prompt Result Types //
interface SuccessfulPromptResult<Result> {
  success: true;
  result: Result;
}

interface FailedPromptResult {
  success: false;
}

export type PromptResult<Result> = SuccessfulPromptResult<Result> | FailedPromptResult;

// Extendable Prompt States //
interface BasePromptState<Result> {
  id: string;
  tabId: number;
  originUrl?: string;
  suppressionKey?: string;

  // Promise and Resolver //
  promise: Promise<PromptResult<Result>>;
  resolver: (value: PromptResult<Result>) => void;
}

// Main Prompt States //
interface TextPromptState extends BasePromptState<string | null> {
  type: "prompt";
  message: string;
  defaultValue: string;
}

interface ConfirmPromptState extends BasePromptState<boolean> {
  type: "confirm";
  message: string;
}

interface AlertPromptState extends BasePromptState<void> {
  type: "alert";
  message: string;
}

export interface BasicAuthCredentials {
  username: string;
  password: string;
}

interface BasicAuthPromptState extends BasePromptState<BasicAuthCredentials | null> {
  type: "basic-auth";
  host: string;
  port: number;
  realm: string;
  scheme: string;
  isProxy: boolean;
}

interface SavePasswordPromptState extends BasePromptState<"save" | "never" | null> {
  type: "save-password";
  candidate: PasswordSaveCandidate;
}

export type SitePermissionPromptResult = "block" | "allow" | "always";

interface SitePermissionPromptState extends BasePromptState<SitePermissionPromptResult> {
  type: "site-permission";
  origin: string;
  permission: string;
  permissionLabelKey: string;
}

// Combined Prompt States //
export type PromptState =
  | TextPromptState
  | ConfirmPromptState
  | AlertPromptState
  | BasicAuthPromptState
  | SavePasswordPromptState
  | SitePermissionPromptState;

// Renderer Types //
export type ActivePrompt = DistributiveOmit<PromptState, "promise" | "resolver">;
