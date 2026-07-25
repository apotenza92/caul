import type { MouseEvent } from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { Button } from "./button"

describe("Button", () => {
  it("activates with pointer, Enter, and Space", async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()

    render(<Button onClick={onClick}>Continue</Button>)

    const button = screen.getByRole("button", { name: "Continue" })

    await user.click(button)
    button.focus()
    await user.keyboard("{Enter}")
    await user.keyboard(" ")

    expect(onClick).toHaveBeenCalledTimes(3)
  })

  it("does not activate when disabled", async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()

    render(
      <Button disabled onClick={onClick}>
        Continue
      </Button>
    )

    const button = screen.getByRole("button", { name: "Continue" })

    await user.click(button)
    button.focus()
    await user.keyboard("{Enter} ")

    expect(button).toBeDisabled()
    expect(onClick).not.toHaveBeenCalled()
  })

  it("keeps reusable picker appearance inside the shadcn Button boundary", () => {
    render(
      <Button data-active="true" size="picker" variant="picker">
        General
      </Button>
    )

    const button = screen.getByRole("button", { name: "General" })

    expect(button).toHaveAttribute("data-size", "picker")
    expect(button).toHaveAttribute("data-variant", "picker")
    expect(button).toHaveClass(
      "h-8",
      "w-full",
      "data-[active=true]:bg-sidebar-accent"
    )
  })

  it("composes a custom element through the Base UI render prop", async () => {
    const user = userEvent.setup()
    const onClick = vi.fn((event: MouseEvent<HTMLElement>) => {
      event.preventDefault()
    })

    render(
      <Button
        nativeButton={false}
        render={<a href="/privacy" onClick={onClick} />}
      >
        Privacy
      </Button>
    )

    const linkButton = screen.getByRole("button", { name: "Privacy" })

    expect(linkButton.tagName).toBe("A")
    expect(linkButton).toHaveAttribute("href", "/privacy")
    expect(linkButton).toHaveAttribute("data-slot", "button")

    await user.click(linkButton)

    expect(onClick).toHaveBeenCalledOnce()
  })
})
