"use client";

import Link from "next/link";

import { UserPen, CircleUser, CreditCard, MessageSquareDot, LogOut, LogIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { User } from "@/data/users";

export function NavUser({
  user,
}: {
  readonly user: User | null;
}) {
  const { isMobile } = useSidebar();

  const handleLogout = async () => {
    try {
      const response = await fetch("https://api.unitoken.trade/api/logout", {
        method: "POST",
        credentials: "include", // Include cookies in the request
      });
      if (response.ok) {
        // Handle successful logout (e.g., redirect or update state)
        window.location.href = "/"; // Redirect to login page
      } else {
        console.error("Logout failed");
      }
    } catch (error) {
      console.error("Error during logout:", error);
    }
  };

  const menuItems = user
    ? [
        { title: "Account", icon: CircleUser, url: "/account" },
        { title: "Billing", icon: CreditCard, url: "/billing" },
        { title: "Notifications", icon: MessageSquareDot, url: "/notifications" },
        { title: "Log out", icon: LogOut, url: "#", onClick: handleLogout },
      ]
    : [{ title: "Log In", icon: LogIn, url: "/login" }];

  const renderMenuItems = () => (
    <DropdownMenuGroup>
      {menuItems.slice(0, user ? -1 : undefined).map((item, index) => (
        <DropdownMenuItem key={index}>
          <Link href={item.url} className="flex items-center w-full">
            {(() => {
              const Icon = item.icon;
              return <Icon className="mr-2 h-4 w-4" />;
            })()}
            <span>{item.title}</span>
          </Link>
        </DropdownMenuItem>
      ))}
    </DropdownMenuGroup>
  );

  const renderLoggedInContent = () => (
    <>
      {renderMenuItems()}
      <DropdownMenuSeparator />
      <DropdownMenuItem>
        <button
          onClick={menuItems[menuItems.length - 1].onClick}
          className="flex items-center w-full"
        >
          {(() => {
            const Icon = menuItems[menuItems.length - 1].icon;
            return <Icon className="mr-2 h-4 w-4" />;
          })()}
          <span>{menuItems[menuItems.length - 1].title}</span>
        </button>
      </DropdownMenuItem>
    </>
  );

  const renderLoggedOutContent = () => (
    <DropdownMenuItem>
      <Link href={menuItems[0].url} className="flex items-center w-full">
        {(() => {
          const Icon = menuItems[0].icon;
          return <Icon className="mr-2 h-4 w-4" />;
        })()}
        <span>{menuItems[0].title}</span>
      </Link>
    </DropdownMenuItem>
  );

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon">
              <UserPen />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            {user ? renderLoggedInContent() : renderLoggedOutContent()}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}