import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs"

function ExampleTabs({ onValueChange = vi.fn() }: { onValueChange?: (value: string | number) => void }) {
  return (
    <Tabs defaultValue="local" onValueChange={onValueChange}>
      <TabsList aria-label="AI provider">
        <TabsTrigger value="local">Local</TabsTrigger>
        <TabsTrigger value="cloud">Cloud</TabsTrigger>
        <TabsTrigger disabled value="disabled">Disabled</TabsTrigger>
      </TabsList>
      <TabsContent value="local">Local panel</TabsContent>
      <TabsContent value="cloud">Cloud panel</TabsContent>
      <TabsContent value="disabled">Disabled panel</TabsContent>
    </Tabs>
  )
}

describe("Tabs", () => {
  it("links each tab to its panel and exposes the selected state", () => {
    render(<ExampleTabs />)

    const localTab = screen.getByRole("tab", { name: "Local", selected: true })
    const localPanel = screen.getByRole("tabpanel")

    expect(localTab).toHaveAttribute("aria-controls", localPanel.id)
    expect(localPanel).toHaveAttribute("aria-labelledby", localTab.id)
    expect(localPanel).toHaveTextContent("Local panel")
  })

  it("uses arrow keys for roving focus, Enter to activate, and blocks disabled activation", async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(<ExampleTabs onValueChange={onValueChange} />)

    await user.tab()
    expect(screen.getByRole("tab", { name: "Local" })).toHaveFocus()

    await user.keyboard("{ArrowRight}")

    expect(screen.getByRole("tab", { name: "Cloud", selected: false })).toHaveFocus()
    await user.keyboard("{Enter}")
    expect(screen.getByRole("tab", { name: "Cloud", selected: true })).toHaveFocus()
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Cloud panel")
    expect(onValueChange).toHaveBeenLastCalledWith("cloud", expect.anything())

    await user.keyboard("{ArrowRight}")
    expect(screen.getByRole("tab", { name: "Disabled", selected: false })).toHaveFocus()
    await user.keyboard("{Enter}")
    expect(screen.getByRole("tab", { name: "Cloud", selected: true })).toBeInTheDocument()

    await user.keyboard("{ArrowRight}")
    expect(screen.getByRole("tab", { name: "Local", selected: false })).toHaveFocus()
    await user.keyboard("{Enter}")
    expect(screen.getByRole("tab", { name: "Local", selected: true })).toHaveFocus()
  })

  it("supports Home and End keyboard navigation", async () => {
    const user = userEvent.setup()
    render(<ExampleTabs />)

    await user.tab()
    await user.keyboard("{End}")
    expect(screen.getByRole("tab", { name: "Disabled", selected: false })).toHaveFocus()

    await user.keyboard("{Home}")
    expect(screen.getByRole("tab", { name: "Local", selected: true })).toHaveFocus()
  })
})
