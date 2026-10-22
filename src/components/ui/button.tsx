import type { ButtonHTMLAttributes } from "react";

import { buttonClasses, type ButtonSize, type ButtonVariant } from "./button-classes";

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={`${buttonClasses(variant, size)} ${className}`} onClick={onClick} {...props} />;
}
