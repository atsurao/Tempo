import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The native plugin is replaced with an in-memory tree so these tests exercise
 * the adapter's path and guard rules, not iOS itself.
 */
const files = new Map<string, string>();
const dirs = new Set<string>([""]);
const hiddenFromExists = new Set<string>();
let getInfoCalls = 0;
let workspaceReadFailures = 0;

vi.mock("tauri-plugin-scoped-storage-api", () => {
  const parts = (path: string) => path.split("/").filter(Boolean);
  return {
    getFolderInfo: async () => {
      getInfoCalls += 1;
      return { name: "Shared" };
    },
    exists: async (_folder: string, path: string) =>
      !hiddenFromExists.has(path) && (files.has(path) || dirs.has(path)),
    stat: async (_folder: string, path: string) => {
      if (files.has(path)) return { isDir: false, size: files.get(path)!.length };
      if (dirs.has(path)) return { isDir: true, size: null };
      throw Object.assign(new Error(`no such file: ${path}`), { code: "NOT_FOUND" });
    },
    mkdir: async (_folder: string, path: string) => {
      if (dirs.has(path)) {
        throw Object.assign(new Error("exists"), { code: "ALREADY_EXISTS" });
      }
      dirs.add(path);
    },
    readDir: async (_folder: string, path: string) => {
      if (!dirs.has(path)) {
        throw Object.assign(new Error(`no such file: ${path}`), { code: "NOT_FOUND" });
      }
      const prefix = path ? `${path}/` : "";
      const names = new Set<string>();
      for (const file of files.keys()) {
        if (file.startsWith(prefix)) names.add(file.slice(prefix.length).split("/")[0]);
      }
      return [...names].map((name) => ({
        name,
        isFile: files.has(`${prefix}${name}`),
        isDir: dirs.has(`${prefix}${name}`),
      }));
    },
    readTextFile: async (_folder: string, path: string) => {
      if (path === "workspace.json" && workspaceReadFailures > 0) {
        workspaceReadFailures -= 1;
        throw Object.assign(new Error(`no such file: ${path}`), { code: "NOT_FOUND" });
      }
      const text = files.get(path);
      if (text === undefined) {
        throw Object.assign(new Error(`no such file: ${path}`), { code: "NOT_FOUND" });
      }
      return text;
    },
    writeTextFile: async (_folder: string, path: string, text: string) => {
      const parents = parts(path).slice(0, -1);
      for (let index = 1; index <= parents.length; index += 1) {
        dirs.add(parents.slice(0, index).join("/"));
      }
      files.set(path, text);
    },
    rename: async (_folder: string, from: string, to: string) => {
      const text = files.get(from);
      if (text === undefined) throw new Error(`no such file: ${from}`);
      files.delete(from);
      files.set(to, text);
    },
    removeFile: async (_folder: string, path: string) => {
      files.delete(path);
    },
  };
});

const { IosSyncFolder } = await import("./iosFolder");

describe("IosSyncFolder", () => {
  beforeEach(() => {
    files.clear();
    dirs.clear();
    dirs.add("");
    hiddenFromExists.clear();
    getInfoCalls = 0;
    workspaceReadFailures = 0;
  });

  it("reads a peer's journal while still refusing to write into it", async () => {
    const mac = new IosSyncFolder({ localDeviceId: "mac-1", folderId: "f" });
    const phone = new IosSyncFolder({ localDeviceId: "phone-1", folderId: "f" });

    await mac.writeMeta("mac-1", "{}");
    await mac.writeBatch("mac-1", 1, "batch");
    await mac.writeSnapshot("mac-1", 0, "snapshot");

    // Pulling a peer is a read: the guard must not treat it as a write.
    await expect(phone.readMeta("mac-1")).resolves.toBe("{}");
    await expect(phone.readBatch("mac-1", 1)).resolves.toBe("batch");
    await expect(phone.readSnapshot("mac-1", 0)).resolves.toBe("snapshot");
    await expect(phone.listBatches("mac-1")).resolves.toEqual([1]);
    await expect(phone.listSnapshots("mac-1")).resolves.toEqual([0]);

    await expect(phone.writeBatch("mac-1", 2, "x")).rejects.toThrow(/another device/);
    await expect(phone.writeMeta("mac-1", "{}")).rejects.toThrow(/another device/);
    await expect(phone.writeSnapshot("mac-1", 1, "x")).rejects.toThrow(/another device/);
    await expect(phone.deleteBatch("mac-1", 1)).rejects.toThrow(/another device/);
  });

  it("treats an absent journal directory as empty", async () => {
    const phone = new IosSyncFolder({ localDeviceId: "phone-1", folderId: "f" });
    await expect(phone.listBatches("phone-1")).resolves.toEqual([]);
    await expect(phone.listSnapshots("phone-1")).resolves.toEqual([]);
  });

  it("reads a workspace without a separate exists probe", async () => {
    const phone = new IosSyncFolder({ localDeviceId: "phone-1", folderId: "f" });
    files.set("workspace.json", "workspace");
    hiddenFromExists.add("workspace.json");

    await expect(phone.readWorkspace()).resolves.toBe("workspace");
    expect(getInfoCalls).toBe(0);
  });

  it("refreshes the handle and retries a missing workspace", async () => {
    const phone = new IosSyncFolder({ localDeviceId: "phone-1", folderId: "f" });
    files.set("workspace.json", "workspace");
    workspaceReadFailures = 1;

    await expect(phone.readWorkspace()).resolves.toBe("workspace");
    expect(getInfoCalls).toBe(1);
  });

  it("reports a genuinely missing workspace only after a refresh", async () => {
    const phone = new IosSyncFolder({ localDeviceId: "phone-1", folderId: "f" });

    await expect(phone.readWorkspace()).resolves.toBeNull();
    expect(getInfoCalls).toBe(1);
  });
});
