import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, embedded newlines, CRLF and BOM", () => {
    const text = '﻿id,document,metadata\r\na,"hello, ""world""","{""k"":1}"\r\nb,"line1\nline2",\r\n';
    expect(parseCsv(text)).toEqual([
      { id: "a", document: 'hello, "world"', metadata: '{"k":1}' },
      { id: "b", document: "line1\nline2", metadata: "" },
    ]);
  });

  it("fills missing trailing cells and skips blank lines", () => {
    expect(parseCsv("id,x,y\n1,2\n\n")).toEqual([{ id: "1", x: "2", y: "" }]);
  });

  it("rejects an unclosed quote", () => {
    expect(() => parseCsv('id\n"abc')).toThrow(/引号/);
  });
});
