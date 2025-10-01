"use client";

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

  const renderMenuItems = () => (
    <DropdownMenuGroup>
      <DropdownMenuItem>
        <CircleUser className="mr-2 h-4 w-4" />
        Account
      </DropdownMenuItem>
      <DropdownMenuItem>
        <CreditCard className="mr-2 h-4 w-4" />
        Billing
      </DropdownMenuItem>
      <DropdownMenuItem>
        <MessageSquareDot className="mr-2 h-4 w-4" />
        Notifications
      </DropdownMenuItem>
    </DropdownMenuGroup>
  );

  const renderLoggedInContent = () => (
    <>
      {renderMenuItems()}
      <DropdownMenuSeparator />
      <DropdownMenuItem>
        <LogOut className="mr-2 h-4 w-4" />
        Log out
      </DropdownMenuItem>
    </>
  );

  const renderLoggedOutContent = () => (
    <DropdownMenuItem>
      <LogIn className="mr-2 h-4 w-4" />
      Log In
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
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
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