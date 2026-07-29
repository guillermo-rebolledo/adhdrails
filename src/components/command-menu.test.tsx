// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommandMenu } from "./command-menu";

const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(() => {
  push.mockClear();
  vi.unstubAllGlobals();
});

function openWithShortcut(user: ReturnType<typeof userEvent.setup>) {
  return user.keyboard("{Meta>}k{/Meta}");
}

function renderCommandMenu() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CommandMenu />
    </QueryClientProvider>,
  );
}

describe("CommandMenu", () => {
  it("opens the palette with Command or Control plus K", async () => {
    const user = userEvent.setup();
    renderCommandMenu();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await openWithShortcut(user);

    expect(
      screen.getByRole("dialog", { name: "Command menu" }),
    ).toBeInTheDocument();
  });

  it("opens from the visible launcher and focuses the search field", async () => {
    const user = userEvent.setup();
    renderCommandMenu();

    await user.click(screen.getByRole("button", { name: "Open command menu" }));

    const search = screen.getByRole("combobox", {
      name: "Search destinations and actions",
    });
    await waitFor(() => expect(search).toHaveFocus());
  });

  it("exposes every destination and the four quick actions", async () => {
    const user = userEvent.setup();
    renderCommandMenu();
    await openWithShortcut(user);

    const list = screen.getByRole("listbox", { name: "Results" });
    for (const label of [
      "Today",
      "Inbox",
      "Tasks",
      "Calendar",
      "Thoughts",
      "Search",
      "Settings",
      "Capture",
      "New Task",
      "New Event",
      "New Thought",
    ]) {
      expect(
        within(list).getByRole("option", { name: new RegExp(label) }),
      ).toBeInTheDocument();
    }
  });

  it("filters destinations as the user types", async () => {
    const user = userEvent.setup();
    renderCommandMenu();
    await openWithShortcut(user);

    // "inbox" starts with a non-accelerator letter, so every keystroke filters.
    await user.type(
      screen.getByRole("combobox", { name: "Search destinations and actions" }),
      "inbox",
    );

    const list = screen.getByRole("listbox", { name: "Results" });
    expect(
      within(list).getByRole("option", { name: /Inbox/ }),
    ).toBeInTheDocument();
    expect(
      within(list).queryByRole("option", { name: /Calendar/ }),
    ).not.toBeInTheDocument();
  });

  it("returns domain content alongside matching navigation actions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [
              {
                id: "10000000-0000-4000-8000-000000000001",
                type: "task",
                title: "Quarterly report",
                excerpt: "",
                href: "/tasks/10000000-0000-4000-8000-000000000001/edit",
              },
            ],
            nextCursor: null,
          }),
        ),
      ),
    );
    const user = userEvent.setup();
    renderCommandMenu();
    await openWithShortcut(user);

    await user.type(
      screen.getByRole("combobox", { name: "Search destinations and actions" }),
      "report",
    );

    const result = await screen.findByRole("option", {
      name: /Quarterly report/,
    });
    expect(result).toHaveTextContent("Task");
    await user.click(result);

    expect(push).toHaveBeenCalledWith(
      "/tasks/10000000-0000-4000-8000-000000000001/edit",
    );
  });

  it("navigates to a destination when an option is chosen", async () => {
    const user = userEvent.setup();
    renderCommandMenu();
    await openWithShortcut(user);

    await user.click(screen.getByRole("option", { name: /Calendar/ }));

    expect(push).toHaveBeenCalledWith("/calendar");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("moves the active option with the arrow keys and runs it on Enter", async () => {
    const user = userEvent.setup();
    renderCommandMenu();
    await openWithShortcut(user);

    // First option (Capture) is active on open; one step down reaches New Task.
    await user.keyboard("{ArrowDown}{Enter}");

    expect(push).toHaveBeenCalledWith("/tasks/new");
  });

  it("runs the quick-action accelerators from the empty palette", async () => {
    const user = userEvent.setup();
    renderCommandMenu();

    await openWithShortcut(user);
    await user.keyboard("c");
    expect(push).toHaveBeenLastCalledWith("/today");

    await openWithShortcut(user);
    await user.keyboard("t");
    expect(push).toHaveBeenLastCalledWith("/tasks/new");

    await openWithShortcut(user);
    await user.keyboard("e");
    expect(push).toHaveBeenLastCalledWith("/calendar/events/new");

    await openWithShortcut(user);
    await user.keyboard("n");
    expect(push).toHaveBeenLastCalledWith("/thoughts/new");
  });

  it("stops treating letters as accelerators once a search is underway", async () => {
    const user = userEvent.setup();
    renderCommandMenu();
    await openWithShortcut(user);

    // "s" is not an accelerator, so it starts a search; the following "t" must
    // then type into the field rather than firing New Task.
    const search = screen.getByRole("combobox", {
      name: "Search destinations and actions",
    });
    await user.type(search, "st");

    expect(push).not.toHaveBeenCalled();
    expect(search).toHaveValue("st");
  });

  it("closes with Escape without navigating", async () => {
    const user = userEvent.setup();
    renderCommandMenu();
    await openWithShortcut(user);

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(push).not.toHaveBeenCalled();
  });
});
