import {eventTargetName} from "./useCase1.js";

function addEventListeners(targets, res, async) {//todo push this into the usecase file?
  for (let el of targets) {
    let name = eventTargetName(el);
    el.addEventListener("click", function (e) {
      res.push(name.toUpperCase() + " ");
      async && Promise.resolve().then(()=>res.push("."));
    }, true);
    el.addEventListener("click", function (e) {
      res.push(name.toLowerCase() + " ");
      async && Promise.resolve().then(()=>res.push("."));
    });
  }
}

export const prop = {
  name: `prop: `,
  fun: function (res, usecase, event) {
    const targets = usecase().flat(Infinity);
    addEventListeners(targets, res, event.async);
    targets[0].dispatchEvent(event);
  }
};

export const dispatchEventTwice = {
  name: "dispatchEventTwice: ",
  fun: function(res, usecase, event){
    const targets = usecase().flat(Infinity);
    targets[0].addEventListener(event.type, e=> res.push(e.type + " "));
    targets[0].dispatchEvent(event);
    targets[0].dispatchEvent(event);
  }
};