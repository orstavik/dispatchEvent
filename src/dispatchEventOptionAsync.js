import {computePropagationPath, scopedPaths} from "./computePaths.js";
import {
  upgradeAddEventListener,
  downgradeAddEventListener
} from "https://cdn.jsdelivr.net/gh/orstavik/getEventListeners@1.2.0/src/runEventListener.js";
import {
  initEvent as initCustomDefaultActions,
  prepareDefaultActions,
  resetEvent as resetCustomDefaultActions
} from "https://cdn.jsdelivr.net/gh/orstavik/nativeDefaultActions@1.2.0/src/getCustomDefaultActions.js";
import {} from "https://cdn.jsdelivr.net/gh/orstavik/nextTick@1/src/nextTick.js";

let getEventListeners;
let clearStopPropagationStateAtTheStartOfDispatchEvent;
let runEventListener;
let patchEventInitialState;
let patchEventListenerState;

function dispatchErrorEvent(error, message) {
  const event = new ErrorEvent('error', {error, message});
  window.dispatchEvent(event);//sync event!
  !event.defaultPrevented && console.error(event);
}

function runListener(target, listener, event) {
  if (listener.removed)
    return;
  if (event.cancelBubble === 1 && !listener.unstoppable)
    return;
  try {
    const cb = listener.listener;
    cb instanceof Function ? cb.call(target, event) : cb.handleEvent(event);
  } catch (error) {
    dispatchErrorEvent(error, 'Uncaught Error: event listener break down');
  } finally {
    listener.once && target.removeEventListener(listener.type, listener.listener, listener.capture);
  }
}

function runDefaultAction(task) {
  try {
    task();
  } catch (error) {
    dispatchErrorEvent(error, 'Uncaught Error: default action break down');
  }
}

function initEvent(event, target) {
  if (event.eventPhase !== 0)
    throw new DOMException("Failed to execute 'dispatchEvent' on 'EventTarget': The event is already being dispatched.");
  //stopped before dispatch.. yes, it is possible to do var e = new Event("abc"); e.stopPropagation(); element.dispatchEvent(e);
  if (event.cancelBubble)
    return;
  if (event.isTrusted)
    event = reuseIsTrustedEvents(event);

  clearStopPropagationStateAtTheStartOfDispatchEvent(event);
  patchEventInitialState(event);
  //we need to freeze the composedPath at the point of first dispatch
  const fullPath = computePropagationPath(target, event.composed, event.bubbles, event.cutOff);
  const composedPath = scopedPaths(target, event.composed).flat(Infinity);
  //todo move the composedPath into the computePropagationPath
  //todo I don't think we need this here, it is a simpler way to build the composed path using .assignedSlot and .host/.parentNode I think
  Object.defineProperties(event, {
    target: {
      get: function () {
        let lowest = target;
        for (let t of this.composedPath()) {
          if (t === this.currentTarget)
            return lowest;
          if (t instanceof DocumentFragment && t.mode === "closed")
            lowest = t.host || lowest;
        }
      },
      configurable: true
    },
    composedPath: {
      value: function () {
        return composedPath;   //we can cache this if we want
      },
      configurable: true
    }
    //timeStamp is when the Event object is created, not when the event is dispatched. This is a pity, this is not good.
  });
  initCustomDefaultActions(event);
  return fullPath;
}

function updateEvent(event, target, phase) {
  Object.defineProperties(event, {
    "currentTarget": {value: target, configurable: true},
    "eventPhase": {value: phase, configurable: true}
  });
}

function resetEvent(event) {
  resetCustomDefaultActions(event);//reset default actions
  Object.defineProperties(event, {
    target: {value: null},
    composedPath: {value: null},
    currentTarget: {value: null},
    eventPhase: {value: 0},
    //timeStamp is when the Event object is created, not when the event is dispatched. This is a pity, this is not good.
  });
}

/**
 * The browser can reuse isTrusted events, ie. dispatch it twice.
 * This is an edge case, very rarely invoked.
 * When the browser reuses isTrusted events, it will re-configure
 * non-configurable properties on the event instance.
 * The event's `.target` and `.composedPath()` are updated for example, while the
 * event object dirty check and timeStamp remain constant.
 * This process cannot be replicated from JS script, one must have "browser privileges" to
 * re-configure non-configurable properties.
 *
 * The alternatives for this method would therefore be to clone the .isTrusted event, or
 * to throw an Error. Because a) a clone would not comply fully (wouldn't work with dirtychecks and
 * get a different timeStamp), and b) the edge case is so rarely used, we simply throw an Error.
 * @param event
 */
function reuseIsTrustedEvents(event) {
  throw new DOMException("The patched EventTarget.dispathEvent() cannot re-dispatch isTrusted events.");
}

/**
 * Exposes the native dispatchEvent method. The async: true behavior reflect that of native events such as dblclick,
 * and the cutOff root, reflect that of focus elements that are yes, composed, but no, doesn't necessarily pass all the
 * way up to the window.
 *
 * @param event with two new event options: {async: true, cutOff: shadowRoot/document}
 * @returns {Promise<void>}
 */
async function dispatchEvent(event) {
  if (!(event instanceof Event))
    throw new TypeError("Failed to execute 'dispatchEvent' on 'EventTarget': parameter 1 is not of type 'Event'.");
  const fullPath = initEvent(event, this);
  if (!fullPath)
    return;
  event.async ?
    await dispatchEventASync(event, fullPath) :
    dispatchEventSync(event, fullPath);
  resetEvent(event);
}

function dispatchEventSync(event, fullPath) {
  for (let {target, phase, listenerPhase} of fullPath) {
    let listeners = getEventListeners(target, event.type, listenerPhase);
    if (event.cancelBubble)             //stopped before this event target/phase
      listeners = listeners.filter(listener => listener.unstoppable);
    if (!listeners.length)
      continue;
    updateEvent(event, target, phase);
    for (let listener of listeners)
      runListener(target, listener, event);
  }
  const tasks = prepareDefaultActions(event);
  for (let task of tasks)
    runDefaultAction(task);
}

async function dispatchEventASync(event, fullPath) {
  let macrotask = nextMesoTicks([function () {
  }], fullPath.length + 2);//todo fix mesotasks

  for (let {target, phase, listenerPhase} of fullPath) {
    let listeners = getEventListeners(target, event.type, listenerPhase);
    if (event.cancelBubble)//either stopped or stoppedImmediately
      listeners = listeners.filter(listener => listener.unstoppable);
    if (!listeners.length)
      continue;
    updateEvent(event, target, phase);
    const cbs = listeners.map(listener => runListener.bind(null, target, listener, event));
    await macrotask.nextMesoTick(cbs);
  }
  const tasks = prepareDefaultActions(event);
  const cbs = tasks.map(task => runDefaultAction.bind(null, task));
  cbs.length && await macrotask.nextMesoTick(cbs);
}

let dispatchEventOG;

export function addDispatchEventOptionAsyncWithDependencies() {
  const {
    getEventListeners: gel,
    clearStopPropagationStateAtTheStartOfDispatchEvent: clearStop,
    runEventListener: runel,
    patchEventInitialState: patch1,
    patchEventListenerState: patch2
  } = upgradeAddEventListener();
  getEventListeners = gel;
  clearStopPropagationStateAtTheStartOfDispatchEvent = clearStop;
  runEventListener = runel;
  patchEventInitialState = patch1;
  patchEventListenerState = patch2;
  dispatchEventOG = Object.getOwnPropertyDescriptor(EventTarget.prototype, "dispatchEvent");
  Object.defineProperty(EventTarget.prototype, "dispatchEvent", {value: dispatchEvent});
}

export function removeDispatchEventOptionAsyncWithDependencies() {
  Object.defineProperty(EventTarget.prototype, "dispatchEvent", dispatchEventOG);
  downgradeAddEventListener();
}