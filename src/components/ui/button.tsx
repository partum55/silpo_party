"use client";

import { useFormStatus } from "react-dom";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { buttonClasses, type ButtonSize, type ButtonVariant } from "./button-classes";

export { buttonClasses, type ButtonSize, type ButtonVariant };

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={`${buttonClasses(variant, size)} ${className}`} onClick={onClick} {...props} />;
}

/** Submit button for a `<form action={...}>` that shows pending state without any local state wiring. */
export function SubmitButton({
  children,
  pendingText,
  variant = "primary",
  size = "md",
  className = "",
}: {
  children: ReactNode;
  pendingText?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`${buttonClasses(variant, size)} ${className}`}>
      {pending ? (pendingText ?? children) : children}
    </button>
  );
}
