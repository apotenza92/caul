import type { FormEvent } from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { Input } from "./input"

describe("Input", () => {
  it("preserves native labelling, editing and form semantics", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      return new FormData(event.currentTarget)
    })

    render(
      <form onSubmit={onSubmit}>
        <label htmlFor="name">Name</label>
        <Input id="name" name="name" required />
        <button type="submit">Save</button>
      </form>
    )

    const input = screen.getByRole("textbox", { name: "Name" })
    await user.type(input, "Caul")
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(input).toHaveValue("Caul")
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(new FormData(input.closest("form")!).get("name")).toBe("Caul")
  })

  it("forwards input type, disabled and invalid states", () => {
    render(
      <Input
        aria-invalid="true"
        aria-label="Private token"
        disabled
        type="password"
      />
    )

    const input = screen.getByLabelText("Private token")
    expect(input).toHaveAttribute("type", "password")
    expect(input).toBeDisabled()
    expect(input).toHaveAttribute("aria-invalid", "true")
  })
})
