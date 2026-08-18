import { describe, expect, test } from "bun:test"
import { localArtifactHref, localArtifactPreviewHref } from "./markdown"

describe("localArtifactHref", () => {
  test("accepts only the local Novel Factory artifact server", () => {
    expect(localArtifactHref("http://127.0.0.1:4177/artifacts/project/files/project.json")).toBe(
      "http://127.0.0.1:4177/artifacts/project/files/project.json",
    )
    expect(localArtifactHref("https://example.com/file.json")).toBeUndefined()
    expect(localArtifactPreviewHref("http://127.0.0.1:4177/artifacts/project/files/project.json")).toBe(
      "http://127.0.0.1:4177/artifacts/project/preview?href=%2Fartifacts%2Fproject%2Ffiles%2Fproject.json",
    )
  })
})
