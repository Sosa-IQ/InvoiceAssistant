import { Outlet, ScrollRestoration } from "react-router-dom"

/** Wraps every route: new pages open at the top; Back/Forward restores the previous scroll position. */
export default function RootLayout() {
  return (
    <>
      <Outlet />
      <ScrollRestoration />
    </>
  )
}
