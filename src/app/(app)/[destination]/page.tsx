import { notFound } from "next/navigation";

const destinations = {
  today: {
    title: "Today",
    description: "One clear place to see what matters now.",
  },
  inbox: {
    title: "Inbox",
    description: "Captured items will wait here without pressure.",
  },
  tasks: {
    title: "Tasks",
    description: "Flexible work stays visible and easy to revisit.",
  },
  thoughts: {
    title: "Thoughts",
    description: "Lightweight references will have a calm home here.",
  },
  search: {
    title: "Search",
    description: "Find tasks, thoughts, and events from one place.",
  },
  settings: {
    title: "Settings",
    description: "Control appearance, integrations, privacy, and support.",
  },
} as const;

type Destination = keyof typeof destinations;

function isDestination(value: string): value is Destination {
  return value in destinations;
}

export default async function DestinationPage({
  params,
}: {
  params: Promise<{ destination: string }>;
}) {
  const { destination } = await params;

  if (!isDestination(destination)) {
    notFound();
  }

  const content = destinations[destination];

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-3">
      <p className="text-sm font-medium text-muted-foreground">
        Application shell
      </p>
      <h1 className="text-3xl font-semibold tracking-tight">{content.title}</h1>
      <p className="max-w-xl text-pretty text-muted-foreground">
        {content.description}
      </p>
      <div className="mt-6 rounded-xl border bg-card p-6 text-card-foreground">
        <p className="font-medium">The foundation is ready.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Product capabilities will arrive here in focused, testable slices.
        </p>
      </div>
    </section>
  );
}
