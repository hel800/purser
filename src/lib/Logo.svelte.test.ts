import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import Logo from "./Logo.svelte";

describe("Logo", () => {
  it("draws the mark at the given size, 20px by default", () => {
    const { container, rerender } = render(Logo);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("20");
    rerender({ size: 32 });
    expect(svg.getAttribute("height")).toBe("32");
  });
});
