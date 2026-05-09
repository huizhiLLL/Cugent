"use client";;
import { forwardRef } from "react";
import { Slot } from "radix-ui";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const TooltipIconButton = forwardRef(({ children, tooltip, side = "bottom", className, ...rest }, ref) => {
  const button = (
    <Button
      variant="ghost"
      size="icon"
      {...rest}
      className={cn("aui-button-icon size-7 p-1.5", className)}
      ref={ref}>
      <Slot.Slottable>{children}</Slot.Slottable>
      {tooltip ? <span className="aui-sr-only sr-only">{tooltip}</span> : null}
    </Button>
  );

  if (!tooltip) {
    return button;
  }

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          {button}
        </TooltipTrigger>
        <TooltipContent side={side}>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});

TooltipIconButton.displayName = "TooltipIconButton";
