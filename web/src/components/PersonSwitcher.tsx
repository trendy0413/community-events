import { Check, ChevronDown, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { personas } from '../demo/people';
import { useSwitchPerson } from '../api/queries';
import { useCurrentPerson } from '../identity';
import { PersonAvatar } from './PersonAvatar';

/** Picks who you are (W2). The server decides what that person may do. */
export function PersonSwitcher() {
  const person = useCurrentPerson();
  const choose = useSwitchPerson();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-9 max-w-[12rem] gap-2 pl-1.5" aria-label="Choose a demo person">
          {person ? (
            <PersonAvatar name={person.name} roles={person.roles} className="size-6 text-[0.65rem]" />
          ) : (
            <UserRound className="ml-1" aria-hidden="true" />
          )}
          <span className="truncate">{person ? person.name : 'Pick a person'}</span>
          <ChevronDown className="text-muted-foreground" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Demo people. No password: you act as the person you pick.
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {personas.map((option) => (
            <DropdownMenuItem
              key={option.id}
              onSelect={() => {
                choose(option.id);
              }}
              className="gap-3 py-2"
            >
              <PersonAvatar name={option.name} roles={option.roles} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">{option.name}</span>
                <span className="text-xs text-muted-foreground">{option.roles.join(', ')}</span>
              </span>
              {option.id === person?.id && <Check className="text-primary" aria-label="Current person" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        {person && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                choose(null);
              }}
              className="text-muted-foreground"
            >
              Act as nobody (see the server answer 401)
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
