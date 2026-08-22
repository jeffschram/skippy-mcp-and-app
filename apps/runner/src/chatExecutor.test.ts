import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildChatPrompt,
  materializeChatAttachments,
  type MaterializedAttachment,
} from "./chatExecutor.js";
import type { ClaimedChatTurn } from "./controlPlane.js";

let tmpDir: string;

beforeEach(() => {
  // realpath: on macOS the temp dir lives behind a /var → /private/var
  // symlink, and assertInsideAllowedRoot compares resolved paths.
  tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "skippy-chat-exec-test-")));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function makeTurn(overrides: Partial<ClaimedChatTurn> = {}): ClaimedChatTurn {
  return {
    turnId: "turn1",
    claimToken: "token",
    chatId: "chat1",
    harness: "claude",
    scopeContext: "The user is chatting from the project \"Demo\".",
    history: [],
    userContent: "Please look at this file",
    ...overrides,
  };
}

function mockFetchWithBody(body: string) {
  const bytes = new TextEncoder().encode(body);
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as Response);
}

describe("materializeChatAttachments", () => {
  it("downloads attachments into the assets folder and returns local paths", async () => {
    const assetsPath = path.join(tmpDir, "_library");
    mockFetchWithBody("hello attachment");
    const result = await materializeChatAttachments(
      {
        assetsPath,
        attachments: [{ fileName: "notes.txt", mimeType: "text/plain", sizeBytes: 16, url: "https://storage.example/1" }],
      },
      tmpDir,
    );
    expect(result).toEqual([{ fileName: "notes.txt", localPath: path.join(assetsPath, "notes.txt") }]);
    expect(fs.readFileSync(path.join(assetsPath, "notes.txt"), "utf8")).toBe("hello attachment");
  });

  it("strips path segments from attachment file names", async () => {
    const assetsPath = path.join(tmpDir, "_library");
    mockFetchWithBody("x");
    const result = await materializeChatAttachments(
      {
        assetsPath,
        attachments: [{ fileName: "../../evil.txt", mimeType: "text/plain", sizeBytes: 1, url: "https://storage.example/1" }],
      },
      tmpDir,
    );
    expect(result[0]?.localPath).toBe(path.join(assetsPath, "evil.txt"));
    expect(fs.existsSync(path.join(tmpDir, "..", "evil.txt"))).toBe(false);
  });

  it("skips the download when an identically sized copy already exists", async () => {
    const assetsPath = path.join(tmpDir, "_library");
    fs.mkdirSync(assetsPath, { recursive: true });
    fs.writeFileSync(path.join(assetsPath, "notes.txt"), "abcd");
    const fetchSpy = mockFetchWithBody("ignored");
    const result = await materializeChatAttachments(
      {
        assetsPath,
        attachments: [{ fileName: "notes.txt", mimeType: "text/plain", sizeBytes: 4, url: "https://storage.example/1" }],
      },
      tmpDir,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result[0]?.localPath).toBe(path.join(assetsPath, "notes.txt"));
  });

  it("degrades to a filename mention when the download fails", async () => {
    const assetsPath = path.join(tmpDir, "_library");
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 404 } as unknown as Response);
    const result = await materializeChatAttachments(
      {
        assetsPath,
        attachments: [{ fileName: "gone.pdf", mimeType: "application/pdf", sizeBytes: 10, url: "https://storage.example/expired" }],
      },
      tmpDir,
    );
    expect(result).toEqual([{ fileName: "gone.pdf" }]);
  });

  it("degrades when no assets folder is mapped or the URL is missing", async () => {
    const result = await materializeChatAttachments(
      {
        attachments: [{ fileName: "a.png", mimeType: "image/png", sizeBytes: 5, url: null }],
      },
      tmpDir,
    );
    expect(result).toEqual([{ fileName: "a.png" }]);
  });

  it("refuses an assets folder outside the allowed root", async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "skippy-outside-"));
    try {
      const fetchSpy = mockFetchWithBody("x");
      const result = await materializeChatAttachments(
        {
          assetsPath: path.join(outside, "_library"),
          attachments: [{ fileName: "a.txt", mimeType: "text/plain", sizeBytes: 1, url: "https://storage.example/1" }],
        },
        tmpDir,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result).toEqual([{ fileName: "a.txt" }]);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("buildChatPrompt", () => {
  const attachments: MaterializedAttachment[] = [
    { fileName: "spec.pdf", localPath: "/root/project/_library/spec.pdf" },
    { fileName: "broken.png" },
  ];

  it("appends local attachment paths on fresh threads", () => {
    const prompt = buildChatPrompt(makeTurn(), attachments);
    expect(prompt).toContain("User: Please look at this file");
    expect(prompt).toContain("The user attached the following file(s) to this message:");
    expect(prompt).toContain("- spec.pdf — saved locally at /root/project/_library/spec.pdf");
    expect(prompt).toContain("- broken.png — stored in the project library (no local copy available this turn)");
  });

  it("appends attachment lines after the bare message on resumed threads", () => {
    const prompt = buildChatPrompt(makeTurn({ externalThreadId: "thread9" }), attachments);
    expect(prompt.startsWith("Please look at this file")).toBe(true);
    expect(prompt).toContain("- spec.pdf — saved locally at /root/project/_library/spec.pdf");
    expect(prompt).not.toContain("Conversation so far:");
  });

  it("leaves prompts unchanged when there are no attachments", () => {
    expect(buildChatPrompt(makeTurn())).not.toContain("attached the following");
    expect(buildChatPrompt(makeTurn({ externalThreadId: "t" }))).toBe("Please look at this file");
  });
});
