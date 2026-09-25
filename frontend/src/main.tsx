import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { LiveProvider } from "./live";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LiveProvider>
      <App />
    </LiveProvider>
  </StrictMode>,
);
