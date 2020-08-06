# WhatIs: Errors in event listeners

When an `Error` occurs during the execution of an event listener function, this `Error` does not directly influence the event propagation function nor the running of later event listeners. Instead, the `Error` is simply caught by the event propagation function and an `error` event is added to the event loop.

The `error` event is dispatched *synchronously*. This means that any event listener for the `error` event *plus* the default action of the error event of printing the error message to the console is done *before* any other event listeners are called.  

```html
<div id="outer">
  <h1 id="inner">Click on me!</h1>
</div>

<script>
  function log(e) {
    console.log(e.type + " on #" + e.currentTarget.id);
  }
  function error() {
    throw new Error("event listener break down");
  }

  const inner = document.querySelector("#inner");
  const outer = document.querySelector("#outer");

  outer.addEventListener("click", error, true);
  inner.addEventListener("click", error);
  inner.addEventListener("click", log);
  outer.addEventListener("click", log);

  window.addEventListener("error", ()=> console.log("error on window"));

  inner.dispatchEvent(new MouseEvent("click", {bubbles: true}));
</script>
```

Results:

```
error on window
  Uncaught Error: event listener break down
    at HTMLDivElement.error ...
error on window
  Uncaught Error: event listener break down
    at HTMLHeadingElement.error ...
click on #inner
click on #outer
```

As we can see, a break down in one event listener doesn't affect the running of later event listeners in the propagation chain, not even when the breakdown occur in an event listener on the same element.

## Implementation

To avoid breaking the iterations of event listeners and propagation targets, we need to capture any errors that occur during the event listener callback. If an error occurs, we *synchronously* dispatch an `error` event on the `window` object. And if no one calls `preventDefault()` on this `error` event, we print the error message to the console.   

```javascript
try {
  listener.cb(event);
} catch (err) {
  const error = new ErrorEvent(
    'Uncaught Error', 
    {error : err, message : 'event listener break down'}
  );                       
  dispatchEvent(window, error);   //asusing the propagation demo dispatchEvent function to also dispatch the error event
  if (!error.defaultPrevented)
    console.error(error);
}
```

## Demo: dispatchEvent masquerade function

```html
<script src="hasGetEventListeners.js"></script>
<script>
  function getComposedPath(target, composed) {
    const path = [];
    while (true) {
      path.push(target);
      if (target.parentNode) {
        target = target.parentNode;
      } else if (target.host) {
        if (!composed)
          return path;
        target = target.host;
      } else if (target.defaultView) {
        target = target.defaultView;
      } else {
        break;
      }
    }
    return path;
  }

  function callListenersOnElement(currentTarget, event, phase) {
    if (event.cancelBubble || event._propagationStoppedImmediately || (phase === Event.BUBBLING_PHASE && !event.bubbles))
      return;
    const listeners = currentTarget.getEventListeners(event.type, phase);
    if (!listeners)
      return;
    Object.defineProperty(event, "currentTarget", {value: currentTarget, writable: true});
    for (let listener of listeners) {
      if (event._propagationStoppedImmediately)
        return;
      if (!currentTarget.hasEventListener(event.type, listener.listener, listener.capture))
        continue;
      try {
        listener.listener(event);
      } catch (err) {
        const error = new ErrorEvent(
          'error',
          {error: err, message: 'Uncaught Error: event listener break down'}
        );
        dispatchEvent(window, error);
        if (!error.defaultPrevented)
          console.error(error);
      }
    }
  }

  function dispatchEvent(target, event) {
    const propagationPath = getComposedPath(target, event.composed).slice(1);
    Object.defineProperty(event, "target", {
      get: function () {
        let lowest = target;
        for (let t of propagationPath) {
          if (t === this.currentTarget)
            return lowest;
          if (t instanceof DocumentFragment && t.mode === "closed")
            lowest = t.host || lowest;
        }
      }
    });
    Object.defineProperty(event, "stopImmediatePropagation", {
      value: function () {
        this._propagationStoppedImmediately = true;
      }
    });
    for (let currentTarget of propagationPath.slice().reverse())
      callListenersOnElement(currentTarget, event, Event.CAPTURING_PHASE);
    callListenersOnElement(target, event, Event.AT_TARGET);
    for (let currentTarget of propagationPath)
      callListenersOnElement(currentTarget, event, Event.BUBBLING_PHASE);
  }

</script>

<div id="outer">
  <h1 id="inner">Click on me!</h1>
</div>

<script>
  function log(e) {
    console.log(e.type + " on #" + e.currentTarget.id);
  }

  function error() {
    throw new Error("event listener break down");
  }

  const inner = document.querySelector("#inner");
  const outer = document.querySelector("#outer");

  outer.addEventListener("click", error, true);
  inner.addEventListener("click", error);
  inner.addEventListener("click", log);
  outer.addEventListener("click", log);

  window.addEventListener("error", log);

  dispatchEvent(inner, new MouseEvent("click", {bubbles: true}));
</script>
```

## References

 [Spec: Runtime script errors](https://html.spec.whatwg.org/#runtime-script-errors)
