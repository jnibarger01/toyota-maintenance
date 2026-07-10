import type { Dispatch, SetStateAction } from "react";
import type { Source } from "../api";

export interface HeaderPresentation {
  source: Source;
  printTo: string;
  printCount: number;
}

export interface ShellOutletContext {
  setHeaderPresentation: Dispatch<SetStateAction<HeaderPresentation | null>>;
}
