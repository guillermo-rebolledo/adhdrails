"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { CircleIcon, MenuIcon } from "lucide-react";

import { CommandMenu } from "@/components/command-menu";
import { navigationDestinations } from "@/components/navigation-items";
import { InboxBadge } from "@/components/inbox/inbox-badge";
import { ThemeMenu } from "@/components/theme-menu";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

function DesktopNavigation() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link
          className="flex h-10 items-center gap-2 px-2 font-semibold"
          href="/today"
        >
          <CircleIcon aria-hidden="true" className="fill-current" />
          <span className="group-data-[collapsible=icon]:hidden">Rails</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <nav aria-label="Primary">
              <SidebarMenu>
                {navigationDestinations.map(({ href, label, icon: Icon }) => (
                  <SidebarMenuItem key={href}>
                    <SidebarMenuButton
                      render={<Link href={href} />}
                      tooltip={label}
                    >
                      <Icon />
                      <span>{label}</span>
                      {href === "/inbox" ? <InboxBadge /> : null}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <p className="px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          Calm focus, one step at a time.
        </p>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function MobileNavigation() {
  return (
    <Drawer swipeDirection="down">
      <DrawerTrigger
        render={
          <Button
            aria-label="Open navigation menu"
            className="md:hidden"
            size="icon-sm"
            variant="ghost"
          />
        }
      >
        <MenuIcon />
      </DrawerTrigger>
      <DrawerContent className="h-dvh max-h-dvh">
        <DrawerHeader>
          <DrawerTitle>Navigation</DrawerTitle>
          <DrawerDescription>Move to another part of Rails.</DrawerDescription>
        </DrawerHeader>
        <nav aria-label="Mobile" className="flex flex-1 flex-col gap-1 p-4">
          {navigationDestinations.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              className={cn(
                buttonVariants({ variant: "ghost" }),
                "w-full justify-start",
              )}
              href={href}
            >
              <Icon data-icon="inline-start" />
              {label}
              {href === "/inbox" ? <InboxBadge /> : null}
            </Link>
          ))}
        </nav>
      </DrawerContent>
    </Drawer>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <DesktopNavigation />
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger
            aria-label="Collapse desktop navigation"
            className="hidden md:inline-flex"
          />
          <MobileNavigation />
          <span className="font-semibold md:hidden">Rails</span>
          <div className="ml-auto flex items-center gap-2">
            <CommandMenu />
            <ThemeMenu />
          </div>
        </header>
        <div className="flex-1 p-5 md:p-8">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
