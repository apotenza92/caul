import { useState } from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { Checkbox, CheckboxDisplay } from "./checkbox"

describe("Checkbox", () => {
  it("associates with a native label and toggles by pointer and Space", async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()

    render(
      <div>
        <Checkbox id="remember" onCheckedChange={onCheckedChange} />
        <label htmlFor="remember">Remember me</label>
      </div>
    )

    const checkbox = screen.getByRole("checkbox", { name: "Remember me" })

    await user.click(screen.getByText("Remember me"))
    expect(checkbox).toBeChecked()

    checkbox.focus()
    await user.keyboard(" ")
    expect(checkbox).not.toBeChecked()
    expect(onCheckedChange).toHaveBeenNthCalledWith(1, true, expect.anything())
    expect(onCheckedChange).toHaveBeenNthCalledWith(2, false, expect.anything())
  })

  it("supports a controlled checked state", async () => {
    const user = userEvent.setup()

    function ControlledCheckbox() {
      const [checked, setChecked] = useState(false)

      return (
        <Checkbox
          aria-label="Controlled option"
          checked={checked}
          onCheckedChange={setChecked}
        />
      )
    }

    render(<ControlledCheckbox />)

    const checkbox = screen.getByRole("checkbox", {
      name: "Controlled option",
    })

    expect(checkbox).not.toBeChecked()
    await user.click(checkbox)
    expect(checkbox).toBeChecked()
    await user.click(checkbox)
    expect(checkbox).not.toBeChecked()
  })

  it("exposes disabled and invalid states without accepting activation", async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()

    const { container } = render(
      <Checkbox
        aria-invalid="true"
        aria-label="Unavailable option"
        disabled
        onCheckedChange={onCheckedChange}
      />
    )

    const checkbox = screen.getByRole("checkbox", {
      name: "Unavailable option",
    })

    expect(checkbox).toHaveAttribute("aria-disabled", "true")
    expect(checkbox).toHaveAttribute("aria-invalid", "true")
    expect(container.querySelector('input[type="checkbox"]')).toBeDisabled()

    await user.click(checkbox)

    expect(checkbox).not.toBeChecked()
    expect(onCheckedChange).not.toHaveBeenCalled()
  })

  it("keeps CheckboxDisplay visual-only and non-interactive", async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <CheckboxDisplay checked aria-label="Saved selection" />
    )

    const display = screen.getByLabelText("Saved selection")

    expect(display).not.toHaveAttribute("role", "checkbox")
    expect(display).not.toHaveAttribute("tabindex")
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()

    await user.click(display)
    expect(display).toHaveAttribute("data-checked")

    rerender(<CheckboxDisplay checked={false} aria-label="Saved selection" />)

    expect(screen.getByLabelText("Saved selection")).not.toHaveAttribute(
      "data-checked"
    )
  })
})
