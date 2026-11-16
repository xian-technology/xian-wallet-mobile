import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";

import { StyleSheet } from "react-native";

import { colors } from "../../theme/colors";
import { UnusedChiBanner } from "../UnusedChiBanner";

const tone = (screen: Awaited<ReturnType<typeof render>>) =>
  StyleSheet.flatten(screen.getByTestId("unused-chi-banner").props.style).backgroundColor;

// The banner sits inside the app's own screens and dialogs: it tells what a
// chi limit's unused chi costs (half of it is charged since revision 14).
describe("UnusedChiBanner", () => {
  it("warns with the extra cost and switches to the estimate on request", async () => {
    const onUseEstimate = jest.fn();
    const screen = await render(
      <UnusedChiBanner supplied={600} estimate={{ estimated: 400, supply: 402 }} chiRate={20} onUseEstimate={onUseEstimate} />
    );

    expect(screen.getByText(/leaves 200 chi unused/)).toBeTruthy();
    expect(tone(screen)).toBe(colors.warningSoft);
    expect(screen.getByRole("alert").props.children).toMatch(/^This chi limit leaves 200 chi unused/);
    await fireEvent.press(screen.getByText("Use estimate (402 chi)"));
    expect(onUseEstimate).toHaveBeenCalledTimes(1);
  });

  it("escalates once the extra at least doubles the fee and offers no switch without a handler", async () => {
    const screen = await render(<UnusedChiBanner supplied={50_000} estimate={{ estimated: 312, supply: 314 }} chiRate={20} />);

    expect(tone(screen)).toBe(colors.dangerSoft);
    expect(screen.queryByText(/Use estimate/)).toBeNull();
  });

  it("renders nothing near the estimate or without a simulation", async () => {
    expect((await render(<UnusedChiBanner supplied={402} estimate={{ estimated: 400, supply: 402 }} chiRate={20} />)).toJSON()).toBeNull();
    expect((await render(<UnusedChiBanner supplied={50_000} estimate={null} chiRate={20} />)).toJSON()).toBeNull();
  });
});
