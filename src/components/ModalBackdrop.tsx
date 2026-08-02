import type { ReactNode } from "react";

export const MODAL_BACKDROP_COLOR = "#00000080";

export interface ModalBackdropProps {
  children: ReactNode;
}

export function ModalBackdrop({ children }: ModalBackdropProps) {
  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      backgroundColor={MODAL_BACKDROP_COLOR}
      alignItems="center"
      justifyContent="center"
    >
      {children}
    </box>
  );
}
