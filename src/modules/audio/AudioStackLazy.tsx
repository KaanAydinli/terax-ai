import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import type { AudioStack as AudioStackType } from "./AudioStack";

const AudioStackInner = lazy(() =>
  import("./AudioStack").then((m) => ({ default: m.AudioStack })),
);

type Props = ComponentProps<typeof AudioStackType>;

export function AudioStack(props: Props) {
  return (
    <Suspense fallback={null}>
      <AudioStackInner {...props} />
    </Suspense>
  );
}
