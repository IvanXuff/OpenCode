import { describe, expect, test } from "bun:test"
import { currentProjectDirectory, discoverNovelProjects, parseNovelProject, restoreNovelProjects } from "./home-novel-projects"

const root = "F:/OpenFiction3"
const valid = JSON.stringify({ title: "午夜档案馆", rootPath: "novels/midnight" })

describe("novel project discovery", () => {
  test("uses the server current project as the empty-list recovery root", async () => {
    expect(
      await currentProjectDirectory({
        project: { current: async () => ({ data: { worktree: "F:/OpenFiction3" } }) },
      }),
    ).toBe("F:/OpenFiction3")
    expect(
      await currentProjectDirectory({
        project: { current: async () => ({ data: { worktree: "" } }) },
      }),
    ).toBeUndefined()
  })

  test("retries an empty-list recovery after a failed current-project request", async () => {
    let attempts = 0
    const opened: string[] = []
    const client = {
      project: {
        current: async () => {
          attempts++
          if (attempts === 1) throw new Error("offline")
          return { data: { worktree: root } }
        },
      },
      file: {
        list: async () => ({ data: [{ type: "directory" as const, absolute: `${root}/novels/midnight` }] }),
        read: async () => ({ data: { type: "text", content: valid } }),
      },
    }

    expect(await restoreNovelProjects(client, (directory) => opened.push(directory))).toBeUndefined()
    expect(await restoreNovelProjects(client, (directory) => opened.push(directory))).toBe(root)
    expect(opened).toEqual([root, `${root}/novels/midnight`])
  })

  test("reports an unreadable novel list so the caller can retry", async () => {
    let attempts = 0
    const client = {
      file: {
        list: async () => {
          attempts++
          if (attempts === 1) throw new Error("offline")
          return { data: [{ type: "directory" as const, absolute: `${root}/novels/midnight` }] }
        },
        read: async () => ({ data: { type: "text", content: valid } }),
      },
    }

    expect(await discoverNovelProjects(client, root)).toBeUndefined()
    expect(await discoverNovelProjects(client, root)).toEqual([{ directory: `${root}/novels/midnight`, title: "午夜档案馆" }])
  })

  test("accepts matching complete project metadata", () => {
    expect(parseNovelProject(root, "F:/OpenFiction3/novels/midnight", valid)).toEqual({
      directory: "F:/OpenFiction3/novels/midnight",
      title: "午夜档案馆",
    })
  })

  test("ignores drafts, damaged metadata, and directories outside the declared root", () => {
    expect(parseNovelProject(root, "F:/OpenFiction3/novels/midnight", "{")).toBeUndefined()
    expect(parseNovelProject(root, "F:/OpenFiction3/novels/midnight", JSON.stringify({ title: "草稿", rootPath: "novels/midnight", status: "draft" }))).toBeUndefined()
    expect(parseNovelProject(root, "F:/OpenFiction3/novels/midnight", JSON.stringify({ title: "错误目录", rootPath: "novels/other" }))).toBeUndefined()
    expect(
      parseNovelProject(
        root,
        "C:/outside/novels/midnight",
        JSON.stringify({ title: "越界目录", rootPath: "C:/outside/novels/midnight" }),
      ),
    ).toBeUndefined()
  })

  test("reads direct novel folders only and ignores unreadable files", async () => {
    const projects = await discoverNovelProjects(
      {
        file: {
          list: async () => ({
            data: [
              { type: "directory", absolute: "F:/OpenFiction3/novels/midnight" },
              { type: "file", absolute: "F:/OpenFiction3/novels/readme.txt" },
            ],
          }),
          read: async ({ directory }) => {
            if (directory.endsWith("midnight")) return { data: { type: "text", content: valid } }
            throw new Error("unreadable")
          },
        },
      },
      root,
    )

    expect(projects).toEqual([{ directory: "F:/OpenFiction3/novels/midnight", title: "午夜档案馆" }])
  })
})
