import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import type { PreviewStack as PreviewStackType } from "./PreviewStack";

const PreviewStackInner = lazy(() =>
  import("./PreviewStack").then((m) => ({ default: m.PreviewStack })),
);

type Props = ComponentProps<typeof PreviewStackType>;

export function PreviewStack(props: Props) {
  return (
    <Suspense fallback={null}>
      <PreviewStackInner {...props} />
    </Suspense>
  );
}
