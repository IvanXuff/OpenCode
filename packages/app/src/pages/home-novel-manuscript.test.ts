import { describe, expect, test } from "bun:test"
import {
  loadNovelChapter,
  loadNovelChapters,
  manuscriptPath,
  manuscriptSession,
  parseNovelChapterIndex,
} from "./home-novel-manuscript"

describe("novel manuscript reader", () => {
  test("reads and orders valid chapter metadata", () => {
    expect(
      parseNovelChapterIndex(
        JSON.stringify({
          chapterIndex: [
            { chapterNo: 2, title: "第二章", sourcePath: "manuscript/vol-main/two.md" },
            { chapterNo: 1, title: "第一章", sourcePath: "manuscript\\vol-main\\one.md" },
          ],
        }),
      ),
    ).toEqual([
      { chapterNo: 1, title: "第一章", sourcePath: "manuscript/vol-main/one.md" },
      { chapterNo: 2, title: "第二章", sourcePath: "manuscript/vol-main/two.md" },
    ])
  })

  test("rejects absolute, traversal, and non-manuscript paths", () => {
    expect(manuscriptPath("C:/outside.md")).toBeUndefined()
    expect(manuscriptPath("/outside.md")).toBeUndefined()
    expect(manuscriptPath("manuscript/../secret.md")).toBeUndefined()
    expect(manuscriptPath("manuscript/./chapter.md")).toBeUndefined()
    expect(manuscriptPath("manuscript//chapter.md")).toBeUndefined()
    expect(manuscriptPath("state/context-index.json")).toBeUndefined()
  })

  test("returns an empty list for a damaged index", () => {
    expect(parseNovelChapterIndex("{")).toEqual([])
    expect(parseNovelChapterIndex(JSON.stringify({ chapterIndex: "bad" }))).toEqual([])
  })

  test("keeps every read scoped to the selected novel directory", async () => {
    const calls: { directory: string; path: string }[] = []
    const client = {
      file: {
        read: async (input: { directory: string; path: string }) => {
          calls.push(input)
          if (input.path === "state/context-index.json") {
            return {
              data: {
                type: "text",
                content: JSON.stringify({
                  chapterIndex: [{ chapterNo: 1, title: "正文", sourcePath: "manuscript/one.md" }],
                }),
              },
            }
          }
          return { data: { type: "text", content: "# 正文" } }
        },
      },
    }

    const chapters = await loadNovelChapters(client, "F:/OpenFiction3/novels/one")
    expect(await loadNovelChapter(client, "F:/OpenFiction3/novels/one", chapters[0]!)).toBe("# 正文")
    expect(calls).toEqual([
      { directory: "F:/OpenFiction3/novels/one", path: "state/context-index.json" },
      { directory: "F:/OpenFiction3/novels/one", path: "manuscript/one.md" },
    ])
  })

  test("treats a missing or empty chapter file as unreadable", async () => {
    const client = { file: { read: async () => ({ data: { type: "text", content: "" } }) } }
    expect(
      await loadNovelChapter(client, "F:/OpenFiction3/novels/one", {
        chapterNo: 1,
        title: "正文",
        sourcePath: "manuscript/one.md",
      }),
    ).toBeUndefined()
  })

  test("reuses the newest root session for the selected novel", async () => {
    let created = false
    const client = {
      session: {
        list: async () => ({
          data: [
            { id: "old", time: { updated: 1 } },
            { id: "child", parentID: "old", time: { updated: 3 } },
            { id: "new", time: { updated: 2 } },
          ],
        }),
        create: async () => {
          created = true
          return { data: { id: "created" } }
        },
      },
    }
    expect(await manuscriptSession(client, "F:/OpenFiction3/novels/one")).toEqual({ id: "new", time: { updated: 2 } })
    expect(created).toBe(false)
  })

  test("creates a reader session when the novel has no root session", async () => {
    const calls: unknown[] = []
    const client = {
      session: {
        list: async (input: unknown) => {
          calls.push(input)
          return { data: [] }
        },
        create: async (input: unknown) => {
          calls.push(input)
          return { data: { id: "reader" } }
        },
      },
    }
    expect(await manuscriptSession(client, "F:/OpenFiction3/novels/one")).toEqual({ id: "reader" })
    expect(calls).toEqual([
      { directory: "F:/OpenFiction3/novels/one", roots: true, limit: 64 },
      { directory: "F:/OpenFiction3/novels/one", title: "小说正文阅读" },
    ])
  })
})
