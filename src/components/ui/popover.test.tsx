import { useState } from "react"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { Button } from "./button"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"

function PopoverExample() {
  return (
    <Popover>
      <PopoverTrigger render={<Button />}>Open actions</PopoverTrigger>
      <PopoverContent aria-label="Actions">
        <button type="button">Run action</button>
      </PopoverContent>
    </Popover>
  )
}

describe("Popover", () => {
  it("opens by pointer without nesting the render-composed Button", async () => {
    const user = userEvent.setup()
    render(<PopoverExample />)

    const trigger = screen.getByRole("button", { name: "Open actions" })
    expect(trigger).toHaveAttribute("data-slot", "popover-trigger")

    await user.click(trigger)

    expect(screen.getAllByRole("button", { name: "Open actions" })).toHaveLength(1)
    expect(screen.getByRole("dialog", { name: "Actions" })).toBeInTheDocument()
    expect(screen.getByText("Run action")).toBeInTheDocument()
  })

  it("opens by keyboard, closes with Escape, and restores trigger focus", async () => {
    const user = userEvent.setup()
    render(<PopoverExample />)

    const trigger = screen.getByRole("button", { name: "Open actions" })
    trigger.focus()
    await user.keyboard("{Enter}")
    await screen.findByText("Run action")
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Run action" })).toHaveFocus()
    )

    await user.keyboard("{Escape}")

    await waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.queryByText("Run action")).not.toBeInTheDocument()
  })

  it("dismisses on an outside pointer press", async () => {
    const user = userEvent.setup()
    render(
      <div>
        <PopoverExample />
        <button type="button">Outside</button>
      </div>
    )

    await user.click(screen.getByRole("button", { name: "Open actions" }))
    await screen.findByText("Run action")
    await user.click(screen.getByRole("button", { name: "Outside" }))

    await waitFor(() =>
      expect(screen.queryByText("Run action")).not.toBeInTheDocument()
    )
  })

  it("supports controlled open state and reports state changes", async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    function ControlledPopover() {
      const [open, setOpen] = useState(false)

      return (
        <Popover
          open={open}
          onOpenChange={(nextOpen, details) => {
            onOpenChange(nextOpen, details.reason)
            setOpen(nextOpen)
          }}
        >
          <PopoverTrigger>Open controlled</PopoverTrigger>
          <PopoverContent>Controlled content</PopoverContent>
        </Popover>
      )
    }

    render(<ControlledPopover />)
    const trigger = screen.getByRole("button", { name: "Open controlled" })

    await user.click(trigger)
    expect(screen.getByText("Controlled content")).toBeInTheDocument()
    expect(onOpenChange).toHaveBeenLastCalledWith(true, "trigger-press")

    await user.keyboard("{Escape}")
    expect(onOpenChange).toHaveBeenLastCalledWith(false, "escape-key")
  })

  it("portals Positioner and Popup and forwards positioning options", async () => {
    const sideOffset = vi.fn(() => 11)
    const alignOffset = vi.fn(() => 7)
    const { container } = render(
      <Popover open>
        <PopoverTrigger>Position trigger</PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          sideOffset={sideOffset}
          alignOffset={alignOffset}
        >
          Positioned content
        </PopoverContent>
      </Popover>
    )

    const popup = await screen.findByText("Positioned content")
    const positioner = popup.closest('[data-slot="popover-positioner"]')

    expect(container).not.toContainElement(popup)
    expect(document.body).toContainElement(popup)
    expect(popup).toHaveAttribute("data-slot", "popover-content")
    expect(positioner).toHaveAttribute("role", "presentation")
    await waitFor(() => {
      expect(positioner).toHaveAttribute("data-side", "top")
      expect(positioner).toHaveAttribute("data-align", "end")
      expect(positioner).toHaveStyle({ transform: "translate(0px, -11px)" })
      expect(sideOffset).toHaveBeenCalled()
      expect(alignOffset).toHaveBeenCalled()
    })
  })
})
