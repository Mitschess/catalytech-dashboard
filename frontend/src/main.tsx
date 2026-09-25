import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Intro } from "./components/Intro";
import { LiveProvider } from "./live";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LiveProvider>
      <App />
      <Intro />
    </LiveProvider>
  </StrictMode>,
);
