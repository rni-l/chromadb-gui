import { describe, expect, it } from "vitest";
import { AUTO_ID, guessMapping, parseRows, toRecords } from "./import";

const load = (name: string, text: string) => {
  const { rows, csv } = parseRows(name, text);
  return toRecords(rows, guessMapping(rows), csv);
};

describe("import mapping", () => {
  it("round-trips this tool's JSONL export", () => {
    const text = [
      JSON.stringify({ id: "a", document: "red", metadata: { kind: "fruit", n: 1 }, embedding: [0.1, 0.2] }),
      JSON.stringify({ id: "b", document: null, metadata: null, embedding: [0.3, 0.4] }),
    ].join("\n");
    expect(load("docs.jsonl", text)).toEqual([
      { id: "a", document: "red", metadata: { kind: "fruit", n: 1 }, embedding: [0.1, 0.2] },
      { id: "b", document: null, embedding: [0.3, 0.4] },
    ]);
  });

  it("round-trips this tool's CSV export, keeping metadata types from the JSON column", () => {
    const text = '﻿id,document,metadata,embedding\r\na,"hi, there","{""n"":1,""s"":""1""}","[1,2]"\r\n';
    expect(load("docs.csv", text)).toEqual([{ id: "a", document: "hi, there", metadata: { n: 1, s: "1" }, embedding: [1, 2] }]);
  });

  it("maps foreign CSV columns to metadata and infers scalar types", () => {
    const { rows, csv } = parseRows("x.csv", "text,page,draft,tag\nhello,3,true,\n");
    const m = guessMapping(rows);
    expect(m).toMatchObject({ id: AUTO_ID, document: "text", embedding: "", metadata: ["page", "draft", "tag"] });
    const [rec] = toRecords(rows, m, csv);
    expect(rec.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(rec).toMatchObject({ document: "hello", metadata: { page: 3, draft: true } });
    expect(toRecords(rows, { ...m, infer: false }, csv)[0].metadata).toEqual({ page: "3", draft: "true" });
  });

  it("accepts Chroma's column format and stringifies nested metadata", () => {
    const text = JSON.stringify({ ids: ["a"], documents: ["d"], metadatas: [{ deep: { x: 1 }, list: [1, 2] }] });
    expect(load("c.json", text)).toEqual([{ id: "a", document: "d", metadata: { deep: '{"x":1}', list: [1, 2] } }]);
  });

  it("reports bad vectors with the row number", () => {
    expect(() => load("v.jsonl", `${JSON.stringify({ id: "a", embedding: [1] })}\n${JSON.stringify({ id: "b", embedding: "oops" })}`)).toThrow(/第 2 条/);
  });
});
