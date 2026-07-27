import { ThoughtForm } from "@/components/thoughts/thought-form";

export default function NewThoughtPage() {
  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">New Thought</h1>
        <p className="mt-2 text-muted-foreground">
          Preserve something useful without turning it into an obligation.
        </p>
      </div>
      <ThoughtForm />
    </section>
  );
}
