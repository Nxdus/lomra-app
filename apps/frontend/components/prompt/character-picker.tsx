"use client";

import { useState } from "react";
import { AtSignIcon } from "lucide-react";
import { CharacterDialog } from "@/components/character-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Character } from "@/lib/characters";
import { listCharacters } from "./character-references";

export function CharacterPicker({ disabled, selectedImage, onPick }: { disabled: boolean; selectedImage?: File; onPick: (name: string) => void }) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [source, setSource] = useState<File>();
  const message = status === "loading" ? "Loading…"
    : status === "error" ? "Could not load Characters. Reopen to retry."
    : !characters.length && !selectedImage ? "Select a canvas image to save a Character." : "";
  return (
    <>
      <DropdownMenu onOpenChange={(open) => {
        if (!open) return;
        setStatus("loading");
        void listCharacters().then((items) => {
          setCharacters(items);
          setStatus("ready");
        }, () => setStatus("error"));
      }}>
        <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" disabled={disabled} aria-label="Characters" title="Characters" />}>
          <AtSignIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Characters</DropdownMenuLabel>
            {message && <p role="status" className="px-2 py-1.5 text-sm text-muted-foreground">{message}</p>}
            {status === "ready" && characters.map(({ id, name }) => <DropdownMenuItem key={id} onClick={() => onPick(name)}>@{name}</DropdownMenuItem>)}
          </DropdownMenuGroup>
          {selectedImage && <>
            {characters.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => setSource(selectedImage)}>Save selected image as Character</DropdownMenuItem>
            </DropdownMenuGroup>
          </>}
        </DropdownMenuContent>
      </DropdownMenu>
      {source && <CharacterDialog file={source} onClose={() => setSource(undefined)} />}
    </>
  );
}
