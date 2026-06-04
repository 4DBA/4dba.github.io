# event-target-bus

A type-safe simple event redistribution bus implementation for `EventTarget` API.

## Installation

```bash
pnpm add event-target-bus
yarn add event-target-bus
npm install event-target-bus
```

## Why?

When working with `EventTarget` API, typically a Web/DOM API, you often need to add and remove event listeners. A small number of listeners on event targets (say a few to a few dozen) has negligible memory and dispatch cost in modern browsers. The cost to add/remove a listener and to call a few listeners when an event fires is very small in normal apps.

However, if you have a large number of listeners (say hundreds or more) on the same event target and event name, the cost can become significant.

This can happen in complex apps or when you have many components that need to listen to the same events. And it is especially true if you are creating a re-usable library/component (say a React/Vue hook/component, a custom web component, etc.) that will be used across the entire app.

In such cases, `event-target-bus` can be beneficial to have a single listener on the event target that redistributes the event to multiple subscribers. This way, you can reduce the overhead of adding/removing listeners and improve performance when dispatching events.

## Usage

**Basic Usage**

```ts
import { createEventTargetBus } from 'event-target-bus';

const onlineBus = createEventTargetBus(
  window,
  'online' /** event name is typed and you get autocomplete and type checking */
);

const handleOnline = (event: Event) => { console.log('The browser is online!'); };

// subscribe to the event
const unsub = onlineBus.on(handleOnline);

// later, when you want to unsubscribe
ubsub();
// or
onlineBus.off(handleOnline);

const mqlBus = createEventTargetBus(window.matchMedia('(prefers-color-scheme: dark)'), 'change');

mqlBus.on((event /** event object is also typed and you will get proper typing `MediaQueryListEvent` here */) => {
  if (event.matches) {
    console.log('Dark mode is preferred!');
  } else {
    console.log('Light mode is preferred!');
  }
});

mqlBus.on((evt) => {});

// with multiple `on` calls, you will only result in one event listener actually attached to the EventTarget
```

**Usage with React `useSyncExternalStore`**

```ts
// React official docs `useSyncExternalStore` "Subscribing to a browser API" example, but
// implemented with `event-target-bus` for better performance when there are many subscribers
// https://react.dev/reference/react/useSyncExternalStore#subscribing-to-a-browser-api

import { createEventTargetBus } from 'event-target-bus';
import type { EventTargetBus } from 'event-target-bus';

let onlineBus: EventTargetBus<Window, 'online'> | null = null;
let offlineBus: EventTargetBus<Window, 'offline'> | null = null;

function subscribe(callback) {
  if (typeof window === 'undefined') {
    // In SSR, we can return a no-op unsubscribe function
    return () => {};
  }

  onlineBus ??= createEventTargetBus(window, 'online');
  offlineBus ??= createEventTargetBus(window, 'offline');

  const unsubOnline = onlineBus.on(callback);
  const unsubOffline = offlineBus.on(callback);

  return () => {
    unsubOnline();
    unsubOffline();
  };
}

function getSnapshot() {
  return navigator.onLine;
}

function useOnline() {
  return useSyncExternalStore(subscribe, getSnapshot);
}
```

----

**event-target-bus** © [Sukka](https://github.com/SukkaW), Released under the [MIT](./LICENSE) License.
Authored and maintained by Sukka with help from contributors ([list](https://github.com/SukkaW/event-target-bus/graphs/contributors)).

> [Personal Website](https://skk.moe) · [Blog](https://blog.skk.moe) · GitHub [@SukkaW](https://github.com/SukkaW) · Telegram Channel [@SukkaChannel](https://t.me/SukkaChannel) · Mastodon [@sukka@acg.mn](https://acg.mn/@sukka) · Twitter [@isukkaw](https://twitter.com/isukkaw) · BlueSky [@skk.moe](https://bsky.app/profile/skk.moe)

<p align="center">
  <a href="https://github.com/sponsors/SukkaW/">
    <img src="https://sponsor.cdn.skk.moe/sponsors.svg"/>
  </a>
</p>
