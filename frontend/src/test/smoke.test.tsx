import { render, screen } from "@testing-library/react"

function Hello() {
  return <div>harness online</div>
}

describe("frontend test harness", () => {
  it("mounts a trivial component in jsdom", () => {
    render(<Hello />)
    expect(screen.getByText("harness online")).toBeInTheDocument()
  })
})
