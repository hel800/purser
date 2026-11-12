import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/svelte";
import { createRawSnippet, flushSync } from "svelte";
import Toast from "./Toast.svelte";

const message = createRawSnippet(() => ({ render: () => "<span>Saved</span>" }));

describe("Toast", () => {
  it("shows the message on flash and hides it again, restarting on each flash", async () => {
    vi.useFakeTimers();
    const { component } = render(Toast, { children: message });
    expect(screen.queryByRole("status")).toBeNull();

    flushSync(() => component.flash());
    expect(screen.getByRole("status").textContent).toBe("Saved");

    await vi.advanceTimersByTimeAsync(1500);
    flushSync(() => component.flash());
    await vi.advanceTimersByTimeAsync(1500);
    expect(screen.queryByRole("status")).not.toBeNull();

    await vi.advanceTimersByTimeAsync(400);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
