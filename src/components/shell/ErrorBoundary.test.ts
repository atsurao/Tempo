import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

describe("ErrorBoundary", () => {
  it("renders its children while nothing has failed", () => {
    const boundary = new ErrorBoundary({ children: createElement("span", null, "calendar") });
    expect(renderToStaticMarkup(boundary.render() as ReactElement)).toBe("<span>calendar</span>");
  });

  it("shows the failure and a way out instead of a blank window", () => {
    const boundary = new ErrorBoundary({ children: null });
    boundary.state = ErrorBoundary.getDerivedStateFromError(new Error("Invalid time value"));
    const html = renderToStaticMarkup(boundary.render() as ReactElement);

    expect(html).toContain("Tempo hit a snag");
    expect(html).toContain("Invalid time value");
    expect(html).toContain("Try again");
    expect(html).toContain("Reload Tempo");
  });
});
