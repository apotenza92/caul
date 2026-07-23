import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { Checkbox } from "./checkbox"
import { Field, FieldLabel } from "./field"
import { Input } from "./input"
import { Textarea } from "./textarea"

describe("Field", () => {
  it("associates a label with an input", async () => {
    const user = userEvent.setup()

    render(
      <Field>
        <FieldLabel htmlFor="display-name">Display name</FieldLabel>
        <Input id="display-name" />
      </Field>
    )

    const input = screen.getByRole("textbox", { name: "Display name" })

    await user.type(input, "Alex")

    expect(input).toHaveValue("Alex")
  })

  it("associates a label with a textarea", async () => {
    const user = userEvent.setup()

    render(
      <Field>
        <FieldLabel htmlFor="notes">Notes</FieldLabel>
        <Textarea id="notes" />
      </Field>
    )

    const textarea = screen.getByRole("textbox", { name: "Notes" })

    await user.type(textarea, "Call summary")

    expect(textarea).toHaveValue("Call summary")
  })

  it("associates a label with a checkbox and delegates pointer activation", async () => {
    const user = userEvent.setup()

    render(
      <Field orientation="horizontal">
        <Checkbox id="share-context" />
        <FieldLabel htmlFor="share-context">Share screen context</FieldLabel>
      </Field>
    )

    const checkbox = screen.getByRole("checkbox", {
      name: "Share screen context",
    })

    await user.click(screen.getByText("Share screen context"))

    expect(checkbox).toBeChecked()
  })
})
