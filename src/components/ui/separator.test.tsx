import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Separator } from "./separator"

describe("Separator", () => {
  it("is decorative by default", () => {
    const { container } = render(<Separator orientation="vertical" />)
    const separator = container.querySelector('[data-slot="separator"]')

    expect(screen.queryByRole("separator")).not.toBeInTheDocument()
    expect(separator).toHaveAttribute("role", "none")
    expect(separator).not.toHaveAttribute("aria-orientation")
  })

  it("can be made semantic and exposes its orientation", () => {
    render(<Separator decorative={false} orientation="vertical" />)

    expect(screen.getByRole("separator")).toHaveAttribute(
      "aria-orientation",
      "vertical"
    )
  })
})
