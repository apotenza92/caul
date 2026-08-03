import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

type VerticalToggleGroupProps = Omit<ComponentProps<typeof ToggleGroupPrimitive>, 'className' | 'orientation'> & {
  className?: string;
};

// The official generated ToggleGroup was considered first, but its current
// Base UI Nova wrapper does not forward orientation to the primitive. This
// narrow adapter restores vertical roving focus without changing registry code.
export function VerticalToggleGroup({ className, ...props }: VerticalToggleGroupProps) {
  return (
    <ToggleGroupPrimitive
      className={cn('group/toggle-group flex w-fit flex-col items-stretch gap-2', className)}
      data-domain-ui="vertical-toggle-group"
      data-slot="toggle-group"
      data-spacing="2"
      orientation="vertical"
      {...props}
    />
  );
}
