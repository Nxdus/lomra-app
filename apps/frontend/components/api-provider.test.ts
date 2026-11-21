import assert from "node:assert/strict";
import { test } from "node:test";
import { callProvider, MissingApiKeyError } from "./api-provider";

test("missing API keys identify the provider for the setup action", async () => {
  await assert.rejects(
    callProvider("google", "", { action: "chat" }),
    (error: unknown) => error instanceof MissingApiKeyError &&
      error.provider === "google" && error.message.includes("Google AI API key"),
  );
});
