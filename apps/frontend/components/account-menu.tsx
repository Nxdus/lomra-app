"use client";

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { LogInIcon, LogOutIcon, LoaderCircleIcon, UserRoundIcon } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { toast } from '@/components/ui/toast';

export function AccountMenu() {
  const { data, isPending, error: sessionError } = authClient.useSession();
  const [busy, setBusy] = useState(false);
  const searchParams = useSearchParams();
  const authError = searchParams.has('authError') ? 'Google sign-in was cancelled or failed. Please try again.' : '';
  const identity = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (authError) toast.add({ id: 'google-auth-error', title: authError, type: 'error' });
  }, [authError]);
  useEffect(() => {
    if (sessionError) toast.add({ id: 'auth-session-error', title: 'Could not check your session. Reload to retry.', type: 'error' });
  }, [sessionError]);
  useEffect(() => {
    if (isPending || sessionError) return;
    const current = data?.user.id ?? null;
    if (identity.current !== undefined && identity.current !== current) window.location.reload();
    identity.current = current;
  }, [data?.user.id, isPending, sessionError]);

  async function signIn() {
    setBusy(true);
    try {
      const result = await authClient.signIn.social({ provider: 'google', callbackURL: '/', errorCallbackURL: '/?authError=1' });
      if (result.error) throw new Error(result.error.message);
    } catch {
      toast.add({ title: 'Could not start Google sign-in. Please try again.', type: 'error' });
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error(result.error.message);
      window.location.reload();
    } catch {
      toast.add({ title: 'Could not sign out. Please try again.', type: 'error' });
      setBusy(false);
    }
  }

  return (
    <div className="fixed top-4 right-4 z-20 flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2">
      {data?.user ? (
        <Popover>
          <PopoverTrigger render={<Button variant="outline" size="icon-sm" aria-label={`Open profile for ${data.user.name}`} title={data.user.name} />}>
            <Avatar>
              <AvatarImage src={data.user.image ?? undefined} alt="" referrerPolicy="no-referrer" />
              <AvatarFallback><UserRoundIcon aria-hidden="true" /></AvatarFallback>
            </Avatar>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={8} className="w-64 max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0 shadow-lg">
            <div className="flex items-center gap-3 px-3 py-3.5">
              <Avatar>
                <AvatarImage src={data.user.image ?? undefined} alt="" referrerPolicy="no-referrer" />
                <AvatarFallback><UserRoundIcon aria-hidden="true" /></AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <PopoverTitle className="truncate text-sm">{data.user.name}</PopoverTitle>
                <p className="truncate text-xs text-muted-foreground" title={data.user.email}>{data.user.email}</p>
              </div>
            </div>
            <Separator />
            <div className="p-1.5">
              <Button variant="ghost" className="w-full justify-start" disabled={busy} onClick={signOut}>
                {busy ? <LoaderCircleIcon data-icon="inline-start" className="animate-spin" /> : <LogOutIcon data-icon="inline-start" />}
                {busy ? 'Signing out…' : 'Sign out'}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      ) : (
        <Button variant="outline" size="icon-sm" aria-label="Sign in with Google" title="Sign in with Google" disabled={busy || isPending} onClick={signIn}>
          {busy || isPending ? <LoaderCircleIcon aria-hidden="true" className="animate-spin" /> : <LogInIcon aria-hidden="true" />}
        </Button>
      )}
    </div>
  );
}
