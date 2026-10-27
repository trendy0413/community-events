import { ArrowRight, ShieldCheck, Swords } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useQueryClient } from '@tanstack/react-query';
import { PersonAvatar } from '../components/PersonAvatar';
import { personas } from '../demo/people';
import { setCurrentPerson, useCurrentPerson } from '../identity';

const GROUPS = [
  { role: 'organizer', title: 'Organizers' },
  { role: 'attendee', title: 'Attendees' },
  { role: 'admin', title: 'Admin' },
];

export function StartPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const current = useCurrentPerson();

  const continueAs = (id: string, to: string) => {
    setCurrentPerson(id);
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'health' });
    void navigate(to);
  };

  return (
    <div className="space-y-10">
      <section className="max-w-2xl space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Community events, with a seat limit you can try to break.
        </h1>
        <p className="text-lg text-muted-foreground text-pretty">
          Organizers create events with a capacity. Attendees register and cancel. Every button here calls the live API
          and a real PostgreSQL database.
        </p>
      </section>

      <Card className="border-primary/30 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Swords className="size-5 text-primary" aria-hidden="true" />
            Try to overbook it
          </CardTitle>
          <CardDescription className="text-base">
            Send 50 people at an event with 10 seats, all at the same moment. Then read the database back and count.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild size="lg">
            <Link to="/proof">
              Open the proof page <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </CardFooter>
      </Card>

      <section aria-labelledby="people-heading" className="space-y-4">
        <div className="space-y-1">
          <h2 id="people-heading" className="text-xl font-semibold tracking-tight">
            Or pick a person
          </h2>
          <p className="text-sm text-muted-foreground">
            No password: the person you pick is sent with every request. The server checks what that person may do.
          </p>
        </div>
        {GROUPS.map((group) => (
          <div key={group.role} className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">{group.title}</h3>
            <ul className="grid gap-3 sm:grid-cols-2">
              {personas
                .filter((person) => person.roles[0] === group.role)
                .map((person) => (
                  <li key={person.id}>
                    <Card size="sm" className="h-full">
                      <CardContent className="flex items-start gap-3">
                        <PersonAvatar name={person.name} roles={person.roles} className="size-10 text-sm" />
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{person.name}</span>
                            {person.roles.map((role) => (
                              <Badge key={role} variant="secondary">
                                {role}
                              </Badge>
                            ))}
                            {current?.id === person.id && <Badge>you</Badge>}
                          </div>
                          <p className="text-sm text-muted-foreground">{person.tryThis}</p>
                        </div>
                      </CardContent>
                      <CardFooter>
                        <Button
                          variant="outline"
                          className="w-full"
                          onClick={() => {
                            continueAs(person.id, person.startAt);
                          }}
                        >
                          Continue as {person.name.split(' ')[0]}
                        </Button>
                      </CardFooter>
                    </Card>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="flex items-start gap-3 rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
        <p>
          This page holds no rules of its own. It does not count seats or check roles; it shows what the server
          answered, including when the server says no.
        </p>
      </section>
    </div>
  );
}
