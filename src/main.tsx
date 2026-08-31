import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { MaskDebugPage } from "./MaskDebugPage";
import "./styles.css";

const pathname = window.location.pathname.replace(/\/+$/u, "") || "/";
const RootPage = pathname === "/mask-debug" ? MaskDebugPage : App;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootPage />
  </StrictMode>,
);
