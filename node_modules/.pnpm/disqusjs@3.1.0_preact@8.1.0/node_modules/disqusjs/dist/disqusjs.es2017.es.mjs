function _define_property(obj, key, value) {
    if (key in obj) {
        Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true });
    } else obj[key] = value;

    return obj;
}

function _object_spread(target) {
    for (var i = 1; i < arguments.length; i++) {
        var source = arguments[i] != null ? arguments[i] : {};
        var ownKeys = Object.keys(source);

        if (typeof Object.getOwnPropertySymbols === "function") {
            ownKeys = ownKeys.concat(
                Object.getOwnPropertySymbols(source).filter(function(sym) {
                    return Object.getOwnPropertyDescriptor(source, sym).enumerable;
                })
            );
        }

        ownKeys.forEach(function(key) {
            _define_property(target, key, source[key]);
        });
    }

    return target;
}

var n$1,l$1,t$5,i$2,r$2,o$5,e$3,f$2,c$1,s$1,a$1,h$1,p$1={},v$1=[],y$1=/acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i,d$1=Array.isArray;function w$1(n,l){for(var t in l)n[t]=l[t];return n}function g$1(n){n&&n.parentNode&&n.parentNode.removeChild(n);}function _$1(l,t,u){var i,r,o,e={};for(o in t)"key"==o?i=t[o]:"ref"==o?r=t[o]:e[o]=t[o];if(arguments.length>2&&(e.children=arguments.length>3?n$1.call(arguments,2):u),"function"==typeof l&&null!=l.defaultProps)for(o in l.defaultProps) void 0===e[o]&&(e[o]=l.defaultProps[o]);return m$1(l,e,i,r,null)}function m$1(n,u,i,r,o){var e={type:n,props:u,key:i,ref:r,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:null==o?++t$5:o,__i:-1,__u:0};return null==o&&null!=l$1.vnode&&l$1.vnode(e),e}function k$1(n){return n.children}function x$1(n,l){this.props=n,this.context=l;}function S(n,l){if(null==l)return n.__?S(n.__,n.__i+1):null;for(var t;l<n.__k.length;l++)if(null!=(t=n.__k[l])&&null!=t.__e)return t.__e;return "function"==typeof n.type?S(n):null}function C$1(n){var l,t;if(null!=(n=n.__)&&null!=n.__c){for(n.__e=n.__c.base=null,l=0;l<n.__k.length;l++)if(null!=(t=n.__k[l])&&null!=t.__e){n.__e=n.__c.base=t.__e;break}return C$1(n)}}function M$1(n){(!n.__d&&(n.__d=true)&&i$2.push(n)&&!$.__r++||r$2!==l$1.debounceRendering)&&((r$2=l$1.debounceRendering)||o$5)($);}function $(){for(var n,t,u,r,o,f,c,s=1;i$2.length;)i$2.length>s&&i$2.sort(e$3),n=i$2.shift(),s=i$2.length,n.__d&&(u=void 0,o=(r=(t=n).__v).__e,f=[],c=[],t.__P&&((u=w$1({},r)).__v=r.__v+1,l$1.vnode&&l$1.vnode(u),O(t.__P,u,r,t.__n,t.__P.namespaceURI,32&r.__u?[o]:null,f,null==o?S(r):o,!!(32&r.__u),c),u.__v=r.__v,u.__.__k[u.__i]=u,z$1(f,u,c),u.__e!=o&&C$1(u)));$.__r=0;}function I(n,l,t,u,i,r,o,e,f,c,s){var a,h,y,d,w,g,_=u&&u.__k||v$1,m=l.length;for(f=P$1(t,l,_,f,m),a=0;a<m;a++)null!=(y=t.__k[a])&&(h=-1===y.__i?p$1:_[y.__i]||p$1,y.__i=a,g=O(n,y,h,i,r,o,e,f,c,s),d=y.__e,y.ref&&h.ref!=y.ref&&(h.ref&&q$2(h.ref,null,y),s.push(y.ref,y.__c||d,y)),null==w&&null!=d&&(w=d),4&y.__u||h.__k===y.__k?f=A$2(y,f,n):"function"==typeof y.type&&void 0!==g?f=g:d&&(f=d.nextSibling),y.__u&=-7);return t.__e=w,f}function P$1(n,l,t,u,i){var r,o,e,f,c,s=t.length,a=s,h=0;for(n.__k=new Array(i),r=0;r<i;r++)null!=(o=l[r])&&"boolean"!=typeof o&&"function"!=typeof o?(f=r+h,(o=n.__k[r]="string"==typeof o||"number"==typeof o||"bigint"==typeof o||o.constructor==String?m$1(null,o,null,null,null):d$1(o)?m$1(k$1,{children:o},null,null,null):void 0===o.constructor&&o.__b>0?m$1(o.type,o.props,o.key,o.ref?o.ref:null,o.__v):o).__=n,o.__b=n.__b+1,e=null,-1!==(c=o.__i=L(o,t,f,a))&&(a--,(e=t[c])&&(e.__u|=2)),null==e||null===e.__v?(-1==c&&(i>s?h--:i<s&&h++),"function"!=typeof o.type&&(o.__u|=4)):c!=f&&(c==f-1?h--:c==f+1?h++:(c>f?h--:h++,o.__u|=4))):n.__k[r]=null;if(a)for(r=0;r<s;r++)null!=(e=t[r])&&0==(2&e.__u)&&(e.__e==u&&(u=S(e)),B$2(e,e));return u}function A$2(n,l,t){var u,i;if("function"==typeof n.type){for(u=n.__k,i=0;u&&i<u.length;i++)u[i]&&(u[i].__=n,l=A$2(u[i],l,t));return l}n.__e!=l&&(l&&n.type&&!t.contains(l)&&(l=S(n)),t.insertBefore(n.__e,l||null),l=n.__e);do{l=l&&l.nextSibling;}while(null!=l&&8==l.nodeType);return l}function H$1(n,l){return l=l||[],null==n||"boolean"==typeof n||(d$1(n)?n.some(function(n){H$1(n,l);}):l.push(n)),l}function L(n,l,t,u){var i,r,o=n.key,e=n.type,f=l[t];if(null===f&&null==n.key||f&&o==f.key&&e===f.type&&0==(2&f.__u))return t;if(u>(null!=f&&0==(2&f.__u)?1:0))for(i=t-1,r=t+1;i>=0||r<l.length;){if(i>=0){if((f=l[i])&&0==(2&f.__u)&&o==f.key&&e===f.type)return i;i--;}if(r<l.length){if((f=l[r])&&0==(2&f.__u)&&o==f.key&&e===f.type)return r;r++;}}return  -1}function T$2(n,l,t){"-"==l[0]?n.setProperty(l,null==t?"":t):n[l]=null==t?"":"number"!=typeof t||y$1.test(l)?t:t+"px";}function j$2(n,l,t,u,i){var r;n:if("style"==l)if("string"==typeof t)n.style.cssText=t;else {if("string"==typeof u&&(n.style.cssText=u=""),u)for(l in u)t&&l in t||T$2(n.style,l,"");if(t)for(l in t)u&&t[l]===u[l]||T$2(n.style,l,t[l]);}else if("o"==l[0]&&"n"==l[1])r=l!=(l=l.replace(f$2,"$1")),l=l.toLowerCase()in n||"onFocusOut"==l||"onFocusIn"==l?l.toLowerCase().slice(2):l.slice(2),n.l||(n.l={}),n.l[l+r]=t,t?u?t.t=u.t:(t.t=c$1,n.addEventListener(l,r?a$1:s$1,r)):n.removeEventListener(l,r?a$1:s$1,r);else {if("http://www.w3.org/2000/svg"==i)l=l.replace(/xlink(H|:h)/,"h").replace(/sName$/,"s");else if("width"!=l&&"height"!=l&&"href"!=l&&"list"!=l&&"form"!=l&&"tabIndex"!=l&&"download"!=l&&"rowSpan"!=l&&"colSpan"!=l&&"role"!=l&&"popover"!=l&&l in n)try{n[l]=null==t?"":t;break n}catch(n){}"function"==typeof t||(null==t||false===t&&"-"!=l[4]?n.removeAttribute(l):n.setAttribute(l,"popover"==l&&1==t?"":t));}}function F$1(n){return function(t){if(this.l){var u=this.l[t.type+n];if(null==t.u)t.u=c$1++;else if(t.u<u.t)return;return u(l$1.event?l$1.event(t):t)}}}function O(n,t,u,i,r,o,e,f,c,s){var a,h,p,v,y,_,m,b,S,C,M,$,P,A,H,L,T,j=t.type;if(void 0!==t.constructor)return null;128&u.__u&&(c=!!(32&u.__u),o=[f=t.__e=u.__e]),(a=l$1.__b)&&a(t);n:if("function"==typeof j)try{if(b=t.props,S="prototype"in j&&j.prototype.render,C=(a=j.contextType)&&i[a.__c],M=a?C?C.props.value:a.__:i,u.__c?m=(h=t.__c=u.__c).__=h.__E:(S?t.__c=h=new j(b,M):(t.__c=h=new x$1(b,M),h.constructor=j,h.render=D$2),C&&C.sub(h),h.props=b,h.state||(h.state={}),h.context=M,h.__n=i,p=h.__d=!0,h.__h=[],h._sb=[]),S&&null==h.__s&&(h.__s=h.state),S&&null!=j.getDerivedStateFromProps&&(h.__s==h.state&&(h.__s=w$1({},h.__s)),w$1(h.__s,j.getDerivedStateFromProps(b,h.__s))),v=h.props,y=h.state,h.__v=t,p)S&&null==j.getDerivedStateFromProps&&null!=h.componentWillMount&&h.componentWillMount(),S&&null!=h.componentDidMount&&h.__h.push(h.componentDidMount);else {if(S&&null==j.getDerivedStateFromProps&&b!==v&&null!=h.componentWillReceiveProps&&h.componentWillReceiveProps(b,M),!h.__e&&(null!=h.shouldComponentUpdate&&!1===h.shouldComponentUpdate(b,h.__s,M)||t.__v==u.__v)){for(t.__v!=u.__v&&(h.props=b,h.state=h.__s,h.__d=!1),t.__e=u.__e,t.__k=u.__k,t.__k.some(function(n){n&&(n.__=t);}),$=0;$<h._sb.length;$++)h.__h.push(h._sb[$]);h._sb=[],h.__h.length&&e.push(h);break n}null!=h.componentWillUpdate&&h.componentWillUpdate(b,h.__s,M),S&&null!=h.componentDidUpdate&&h.__h.push(function(){h.componentDidUpdate(v,y,_);});}if(h.context=M,h.props=b,h.__P=n,h.__e=!1,P=l$1.__r,A=0,S){for(h.state=h.__s,h.__d=!1,P&&P(t),a=h.render(h.props,h.state,h.context),H=0;H<h._sb.length;H++)h.__h.push(h._sb[H]);h._sb=[];}else do{h.__d=!1,P&&P(t),a=h.render(h.props,h.state,h.context),h.state=h.__s;}while(h.__d&&++A<25);h.state=h.__s,null!=h.getChildContext&&(i=w$1(w$1({},i),h.getChildContext())),S&&!p&&null!=h.getSnapshotBeforeUpdate&&(_=h.getSnapshotBeforeUpdate(v,y)),L=a,null!=a&&a.type===k$1&&null==a.key&&(L=N$1(a.props.children)),f=I(n,d$1(L)?L:[L],t,u,i,r,o,e,f,c,s),h.base=t.__e,t.__u&=-161,h.__h.length&&e.push(h),m&&(h.__E=h.__=null);}catch(n){if(t.__v=null,c||null!=o)if(n.then){for(t.__u|=c?160:128;f&&8==f.nodeType&&f.nextSibling;)f=f.nextSibling;o[o.indexOf(f)]=null,t.__e=f;}else for(T=o.length;T--;)g$1(o[T]);else t.__e=u.__e,t.__k=u.__k;l$1.__e(n,t,u);}else null==o&&t.__v==u.__v?(t.__k=u.__k,t.__e=u.__e):f=t.__e=V$1(u.__e,t,u,i,r,o,e,c,s);return (a=l$1.diffed)&&a(t),128&t.__u?void 0:f}function z$1(n,t,u){for(var i=0;i<u.length;i++)q$2(u[i],u[++i],u[++i]);l$1.__c&&l$1.__c(t,n),n.some(function(t){try{n=t.__h,t.__h=[],n.some(function(n){n.call(t);});}catch(n){l$1.__e(n,t.__v);}});}function N$1(n){return "object"!=typeof n||null==n?n:d$1(n)?n.map(N$1):w$1({},n)}function V$1(t,u,i,r,o,e,f,c,s){var a,h,v,y,w,_,m,b=i.props,k=u.props,x=u.type;if("svg"==x?o="http://www.w3.org/2000/svg":"math"==x?o="http://www.w3.org/1998/Math/MathML":o||(o="http://www.w3.org/1999/xhtml"),null!=e)for(a=0;a<e.length;a++)if((w=e[a])&&"setAttribute"in w==!!x&&(x?w.localName==x:3==w.nodeType)){t=w,e[a]=null;break}if(null==t){if(null==x)return document.createTextNode(k);t=document.createElementNS(o,x,k.is&&k),c&&(l$1.__m&&l$1.__m(u,e),c=false),e=null;}if(null===x)b===k||c&&t.data===k||(t.data=k);else {if(e=e&&n$1.call(t.childNodes),b=i.props||p$1,!c&&null!=e)for(b={},a=0;a<t.attributes.length;a++)b[(w=t.attributes[a]).name]=w.value;for(a in b)if(w=b[a],"children"==a);else if("dangerouslySetInnerHTML"==a)v=w;else if(!(a in k)){if("value"==a&&"defaultValue"in k||"checked"==a&&"defaultChecked"in k)continue;j$2(t,a,null,w,o);}for(a in k)w=k[a],"children"==a?y=w:"dangerouslySetInnerHTML"==a?h=w:"value"==a?_=w:"checked"==a?m=w:c&&"function"!=typeof w||b[a]===w||j$2(t,a,w,b[a],o);if(h)c||v&&(h.__html===v.__html||h.__html===t.innerHTML)||(t.innerHTML=h.__html),u.__k=[];else if(v&&(t.innerHTML=""),I("template"===u.type?t.content:t,d$1(y)?y:[y],u,i,r,"foreignObject"==x?"http://www.w3.org/1999/xhtml":o,e,f,e?e[0]:i.__k&&S(i,0),c,s),null!=e)for(a=e.length;a--;)g$1(e[a]);c||(a="value","progress"==x&&null==_?t.removeAttribute("value"):void 0!==_&&(_!==t[a]||"progress"==x&&!_||"option"==x&&_!==b[a])&&j$2(t,a,_,b[a],o),a="checked",void 0!==m&&m!==t[a]&&j$2(t,a,m,b[a],o));}return t}function q$2(n,t,u){try{if("function"==typeof n){var i="function"==typeof n.__u;i&&n.__u(),i&&null==t||(n.__u=n(t));}else n.current=t;}catch(n){l$1.__e(n,u);}}function B$2(n,t,u){var i,r;if(l$1.unmount&&l$1.unmount(n),(i=n.ref)&&(i.current&&i.current!==n.__e||q$2(i,null,t)),null!=(i=n.__c)){if(i.componentWillUnmount)try{i.componentWillUnmount();}catch(n){l$1.__e(n,t);}i.base=i.__P=null;}if(i=n.__k)for(r=0;r<i.length;r++)i[r]&&B$2(i[r],t,u||"function"!=typeof n.type);u||g$1(n.__e),n.__c=n.__=n.__e=void 0;}function D$2(n,l,t){return this.constructor(n,t)}function E$1(t,u,i){var r,o,e,f;u==document&&(u=document.documentElement),l$1.__&&l$1.__(t,u),o=(r="function"=="undefined")?null:u.__k,e=[],f=[],O(u,t=(u).__k=_$1(k$1,null,[t]),o||p$1,p$1,u.namespaceURI,o?null:u.firstChild?n$1.call(u.childNodes):null,e,o?o.__e:u.firstChild,r,f),z$1(e,t,f);}function J$1(l,t,u){var i,r,o,e,f=w$1({},l.props);for(o in l.type&&l.type.defaultProps&&(e=l.type.defaultProps),t)"key"==o?i=t[o]:"ref"==o?r=t[o]:f[o]=void 0===t[o]&&void 0!==e?e[o]:t[o];return arguments.length>2&&(f.children=arguments.length>3?n$1.call(arguments,2):u),m$1(l.type,f,i||l.key,r||l.ref,null)}function K$1(n){function l(n){var t,u;return this.getChildContext||(t=new Set,(u={})[l.__c]=this,this.getChildContext=function(){return u},this.componentWillUnmount=function(){t=null;},this.shouldComponentUpdate=function(n){this.props.value!==n.value&&t.forEach(function(n){n.__e=true,M$1(n);});},this.sub=function(n){t.add(n);var l=n.componentWillUnmount;n.componentWillUnmount=function(){t&&t.delete(n),l&&l.call(n);};}),n.children}return l.__c="__cC"+h$1++,l.__=n,l.Provider=l.__l=(l.Consumer=function(n,l){return n.children(l)}).contextType=l,l}n$1=v$1.slice,l$1={__e:function(n,l,t,u){for(var i,r,o;l=l.__;)if((i=l.__c)&&!i.__)try{if((r=i.constructor)&&null!=r.getDerivedStateFromError&&(i.setState(r.getDerivedStateFromError(n)),o=i.__d),null!=i.componentDidCatch&&(i.componentDidCatch(n,u||{}),o=i.__d),o)return i.__E=i}catch(l){n=l;}throw n}},t$5=0,x$1.prototype.setState=function(n,l){var t;t=null!=this.__s&&this.__s!==this.state?this.__s:this.__s=w$1({},this.state),"function"==typeof n&&(n=n(w$1({},t),this.props)),n&&w$1(t,n),null!=n&&this.__v&&(l&&this._sb.push(l),M$1(this));},x$1.prototype.forceUpdate=function(n){this.__v&&(this.__e=true,n&&this.__h.push(n),M$1(this));},x$1.prototype.render=k$1,i$2=[],o$5="function"==typeof Promise?Promise.prototype.then.bind(Promise.resolve()):setTimeout,e$3=function(n,l){return n.__v.__b-l.__v.__b},$.__r=0,f$2=/(PointerCapture)$|Capture$/i,c$1=0,s$1=F$1(false),a$1=F$1(true),h$1=0;

var t$4,r$1,u$1,i$1,o$4=0,f$1=[],c=l$1,e$2=c.__b,a=c.__r,v=c.diffed,l=c.__c,m=c.unmount,s=c.__;function p(n,t){c.__h&&c.__h(r$1,n,o$4||t),o$4=0;var u=r$1.__H||(r$1.__H={__:[],__h:[]});return n>=u.__.length&&u.__.push({}),u.__[n]}function d(n){return o$4=1,h(D$1,n)}function h(n,u,i){var o=p(t$4++,2);if(o.t=n,!o.__c&&(o.__=[i?i(u):D$1(void 0,u),function(n){var t=o.__N?o.__N[0]:o.__[0],r=o.t(t,n);t!==r&&(o.__N=[r,o.__[1]],o.__c.setState({}));}],o.__c=r$1,!r$1.__f)){var f=function(n,t,r){if(!o.__c.__H)return  true;var u=o.__c.__H.__.filter(function(n){return !!n.__c});if(u.every(function(n){return !n.__N}))return !c||c.call(this,n,t,r);var i=o.__c.props!==n;return u.forEach(function(n){if(n.__N){var t=n.__[0];n.__=n.__N,n.__N=void 0,t!==n.__[0]&&(i=true);}}),c&&c.call(this,n,t,r)||i};r$1.__f=true;var c=r$1.shouldComponentUpdate,e=r$1.componentWillUpdate;r$1.componentWillUpdate=function(n,t,r){if(this.__e){var u=c;c=void 0,f(n,t,r),c=u;}e&&e.call(this,n,t,r);},r$1.shouldComponentUpdate=f;}return o.__N||o.__}function y(n,u){var i=p(t$4++,3);!c.__s&&C(i.__H,u)&&(i.__=n,i.u=u,r$1.__H.__h.push(i));}function _(n,u){var i=p(t$4++,4);!c.__s&&C(i.__H,u)&&(i.__=n,i.u=u,r$1.__h.push(i));}function A$1(n){return o$4=5,T$1(function(){return {current:n}},[])}function T$1(n,r){var u=p(t$4++,7);return C(u.__H,r)&&(u.__=n(),u.__H=r,u.__h=n),u.__}function q$1(n,t){return o$4=8,T$1(function(){return n},t)}function x(n){var u=r$1.context[n.__c],i=p(t$4++,9);return i.c=n,u?(null==i.__&&(i.__=true,u.sub(r$1)),u.props.value):n.__}function j$1(){for(var n;n=f$1.shift();)if(n.__P&&n.__H)try{n.__H.__h.forEach(z),n.__H.__h.forEach(B$1),n.__H.__h=[];}catch(t){n.__H.__h=[],c.__e(t,n.__v);}}c.__b=function(n){r$1=null,e$2&&e$2(n);},c.__=function(n,t){n&&t.__k&&t.__k.__m&&(n.__m=t.__k.__m),s&&s(n,t);},c.__r=function(n){a&&a(n),t$4=0;var i=(r$1=n.__c).__H;i&&(u$1===r$1?(i.__h=[],r$1.__h=[],i.__.forEach(function(n){n.__N&&(n.__=n.__N),n.u=n.__N=void 0;})):(i.__h.forEach(z),i.__h.forEach(B$1),i.__h=[],t$4=0)),u$1=r$1;},c.diffed=function(n){v&&v(n);var t=n.__c;t&&t.__H&&(t.__H.__h.length&&(1!==f$1.push(t)&&i$1===c.requestAnimationFrame||((i$1=c.requestAnimationFrame)||w)(j$1)),t.__H.__.forEach(function(n){n.u&&(n.__H=n.u),n.u=void 0;})),u$1=r$1=null;},c.__c=function(n,t){t.some(function(n){try{n.__h.forEach(z),n.__h=n.__h.filter(function(n){return !n.__||B$1(n)});}catch(r){t.some(function(n){n.__h&&(n.__h=[]);}),t=[],c.__e(r,n.__v);}}),l&&l(n,t);},c.unmount=function(n){m&&m(n);var t,r=n.__c;r&&r.__H&&(r.__H.__.forEach(function(n){try{z(n);}catch(n){t=n;}}),r.__H=void 0,t&&c.__e(t,r.__v));};var k="function"==typeof requestAnimationFrame;function w(n){var t,r=function(){clearTimeout(u),k&&cancelAnimationFrame(t),setTimeout(n);},u=setTimeout(r,100);k&&(t=requestAnimationFrame(r));}function z(n){var t=r$1,u=n.__c;"function"==typeof u&&(n.__c=void 0,u()),r$1=t;}function B$1(n){var t=r$1;n.__c=n.__(),r$1=t;}function C(n,t){return !n||n.length!==t.length||t.some(function(t,r){return t!==n[r]})}function D$1(n,t){return "function"==typeof t?t(n):t}

function g(n,t){for(var e in t)n[e]=t[e];return n}function E(n,t){for(var e in n)if("__source"!==e&&!(e in t))return  true;for(var r in t)if("__source"!==r&&n[r]!==t[r])return  true;return  false}function N(n,t){this.props=n,this.context=t;}function M(n,e){function r(n){var t=this.props.ref,r=t==n.ref;return !r&&t&&(t.call?t(null):t.current=null),e?!e(this.props,n)||!r:E(this.props,n)}function u(e){return this.shouldComponentUpdate=r,_$1(n,e)}return u.displayName="Memo("+(n.displayName||n.name)+")",u.prototype.isReactComponent=true,u.__f=true,u}(N.prototype=new x$1).isPureReactComponent=true,N.prototype.shouldComponentUpdate=function(n,t){return E(this.props,n)||E(this.state,t)};var T=l$1.__b;l$1.__b=function(n){n.type&&n.type.__f&&n.ref&&(n.props.ref=n.ref,n.ref=null),T&&T(n);};var A="undefined"!=typeof Symbol&&Symbol.for&&Symbol.for("react.forward_ref")||3911;function D(n){function t(t){var e=g({},t);return delete e.ref,n(e,t.ref||null)}return t.$$typeof=A,t.render=t,t.prototype.isReactComponent=t.__f=true,t.displayName="ForwardRef("+(n.displayName||n.name)+")",t}var F=l$1.__e;l$1.__e=function(n,t,e,r){if(n.then)for(var u,o=t;o=o.__;)if((u=o.__c)&&u.__c)return null==t.__e&&(t.__e=e.__e,t.__k=e.__k),u.__c(n,t);F(n,t,e,r);};var U=l$1.unmount;function V(n,t,e){return n&&(n.__c&&n.__c.__H&&(n.__c.__H.__.forEach(function(n){"function"==typeof n.__c&&n.__c();}),n.__c.__H=null),null!=(n=g({},n)).__c&&(n.__c.__P===e&&(n.__c.__P=t),n.__c=null),n.__k=n.__k&&n.__k.map(function(n){return V(n,t,e)})),n}function W(n,t,e){return n&&e&&(n.__v=null,n.__k=n.__k&&n.__k.map(function(n){return W(n,t,e)}),n.__c&&n.__c.__P===t&&(n.__e&&e.appendChild(n.__e),n.__c.__e=true,n.__c.__P=e)),n}function P(){this.__u=0,this.o=null,this.__b=null;}function j(n){var t=n.__.__c;return t&&t.__a&&t.__a(n)}function B(){this.i=null,this.l=null;}l$1.unmount=function(n){var t=n.__c;t&&t.__R&&t.__R(),t&&32&n.__u&&(n.type=null),U&&U(n);},(P.prototype=new x$1).__c=function(n,t){var e=t.__c,r=this;null==r.o&&(r.o=[]),r.o.push(e);var u=j(r.__v),o=false,i=function(){o||(o=true,e.__R=null,u?u(c):c());};e.__R=i;var c=function(){if(!--r.__u){if(r.state.__a){var n=r.state.__a;r.__v.__k[0]=W(n,n.__c.__P,n.__c.__O);}var t;for(r.setState({__a:r.__b=null});t=r.o.pop();)t.forceUpdate();}};r.__u++||32&t.__u||r.setState({__a:r.__b=r.__v.__k[0]}),n.then(i,i);},P.prototype.componentWillUnmount=function(){this.o=[];},P.prototype.render=function(n,e){if(this.__b){if(this.__v.__k){var r=document.createElement("div"),o=this.__v.__k[0].__c;this.__v.__k[0]=V(this.__b,r,o.__O=o.__P);}this.__b=null;}var i=e.__a&&_$1(k$1,null,n.fallback);return i&&(i.__u&=-33),[_$1(k$1,null,e.__a?null:n.children),i]};var H=function(n,t,e){if(++e[1]===e[0]&&n.l.delete(t),n.props.revealOrder&&("t"!==n.props.revealOrder[0]||!n.l.size))for(e=n.i;e;){for(;e.length>3;)e.pop()();if(e[1]<e[0])break;n.i=e=e[2];}};(B.prototype=new x$1).__a=function(n){var t=this,e=j(t.__v),r=t.l.get(n);return r[0]++,function(u){var o=function(){t.props.revealOrder?(r.push(u),H(t,n,r)):u();};e?e(o):o();}},B.prototype.render=function(n){this.i=null,this.l=new Map;var t=H$1(n.children);n.revealOrder&&"b"===n.revealOrder[0]&&t.reverse();for(var e=t.length;e--;)this.l.set(t[e],this.i=[1,0,this.i]);return n.children},B.prototype.componentDidUpdate=B.prototype.componentDidMount=function(){var n=this;this.l.forEach(function(t,e){H(n,e,t);});};var q="undefined"!=typeof Symbol&&Symbol.for&&Symbol.for("react.element")||60103,G=/^(?:accent|alignment|arabic|baseline|cap|clip(?!PathU)|color|dominant|fill|flood|font|glyph(?!R)|horiz|image(!S)|letter|lighting|marker(?!H|W|U)|overline|paint|pointer|shape|stop|strikethrough|stroke|text(?!L)|transform|underline|unicode|units|v|vector|vert|word|writing|x(?!C))[A-Z]/,J=/^on(Ani|Tra|Tou|BeforeInp|Compo)/,K=/[A-Z0-9]/g,Q="undefined"!=typeof document,X=function(n){return ("undefined"!=typeof Symbol&&"symbol"==typeof Symbol()?/fil|che|rad/:/fil|che|ra/).test(n)};x$1.prototype.isReactComponent={},["componentWillMount","componentWillReceiveProps","componentWillUpdate"].forEach(function(t){Object.defineProperty(x$1.prototype,t,{configurable:true,get:function(){return this["UNSAFE_"+t]},set:function(n){Object.defineProperty(this,t,{configurable:true,writable:true,value:n});}});});var en=l$1.event;function rn(){}function un(){return this.cancelBubble}function on(){return this.defaultPrevented}l$1.event=function(n){return en&&(n=en(n)),n.persist=rn,n.isPropagationStopped=un,n.isDefaultPrevented=on,n.nativeEvent=n};var ln={enumerable:false,configurable:true,get:function(){return this.class}},fn=l$1.vnode;l$1.vnode=function(n){"string"==typeof n.type&&function(n){var t=n.props,e=n.type,u={},o=-1===e.indexOf("-");for(var i in t){var c=t[i];if(!("value"===i&&"defaultValue"in t&&null==c||Q&&"children"===i&&"noscript"===e||"class"===i||"className"===i)){var l=i.toLowerCase();"defaultValue"===i&&"value"in t&&null==t.value?i="value":"download"===i&&true===c?c="":"translate"===l&&"no"===c?c=false:"o"===l[0]&&"n"===l[1]?"ondoubleclick"===l?i="ondblclick":"onchange"!==l||"input"!==e&&"textarea"!==e||X(t.type)?"onfocus"===l?i="onfocusin":"onblur"===l?i="onfocusout":J.test(i)&&(i=l):l=i="oninput":o&&G.test(i)?i=i.replace(K,"-$&").toLowerCase():null===c&&(c=void 0),"oninput"===l&&u[i=l]&&(i="oninputCapture"),u[i]=c;}}"select"==e&&u.multiple&&Array.isArray(u.value)&&(u.value=H$1(t.children).forEach(function(n){n.props.selected=-1!=u.value.indexOf(n.props.value);})),"select"==e&&null!=u.defaultValue&&(u.value=H$1(t.children).forEach(function(n){n.props.selected=u.multiple?-1!=u.defaultValue.indexOf(n.props.value):u.defaultValue==n.props.value;})),t.class&&!t.className?(u.class=t.class,Object.defineProperty(u,"className",ln)):(t.className&&!t.class||t.class&&t.className)&&(u.class=u.className=t.className),n.props=u;}(n),n.$$typeof=q,fn&&fn(n);};var an=l$1.__r;l$1.__r=function(n){an&&an(n),n.__c;};var sn=l$1.diffed;l$1.diffed=function(n){sn&&sn(n);var t=n.props,e=n.__e;null!=e&&"textarea"===n.type&&"value"in t&&t.value!==e.value&&(e.value=null==t.value?"":t.value);};function pn(n){return !!n&&n.$$typeof===q}function _n(n){return pn(n)?J$1.apply(null,arguments):n}

var f=0;function u(e,t,n,o,i,u){t||(t={});var a,c,p=t;if("ref"in p)for(c in p={},t)"ref"==c?a=t[c]:p[c]=t[c];var l={type:e,props:p,key:n,ref:a,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:--f,__i:-1,__u:0,__source:i,__self:u};if("function"==typeof e&&(a=e.defaultProps))for(c in a) void 0===p[c]&&(p[c]=a[c]);return l$1.vnode&&l$1.vnode(l),l}

function ownKeys(object, enumerableOnly) {
    var keys = Object.keys(object);

    if (Object.getOwnPropertySymbols) {
        var symbols = Object.getOwnPropertySymbols(object);
        keys.push.apply(keys, symbols);
    }

    return keys;
}
function _object_spread_props(target, source) {
    source = source != null ? source : {};

    if (Object.getOwnPropertyDescriptors) Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
    else {
        ownKeys(Object(source)).forEach(function(key) {
            Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
        });
    }

    return target;
}

function _object_without_properties_loose(source, excluded) {
    if (source == null) return {};

    var target = {};
    var sourceKeys = Object.keys(source);
    var key, i;

    for (i = 0; i < sourceKeys.length; i++) {
        key = sourceKeys[i];
        if (excluded.indexOf(key) >= 0) continue;
        target[key] = source[key];
    }

    return target;
}

function _object_without_properties(source, excluded) {
    if (source == null) return {};

    var target = _object_without_properties_loose(source, excluded);
    var key, i;

    if (Object.getOwnPropertySymbols) {
        var sourceSymbolKeys = Object.getOwnPropertySymbols(source);
        for (i = 0; i < sourceSymbolKeys.length; i++) {
            key = sourceSymbolKeys[i];
            if (excluded.indexOf(key) >= 0) continue;
            if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue;
            target[key] = source[key];
        }
    }

    return target;
}

function o$3(){const[o,r]=d(false);return y(()=>{r(true);},[]),o}

const t$3=M(e=>{let{contexts:t,children:o}=e;return t.reduceRight((e,t)=>_n(t,{children:e}),o)});

const DisqusJSFooter = /*#__PURE__*/ M(()=>/*#__PURE__*/ u("footer", {
        className: "dsqjs-footer-container",
        children: /*#__PURE__*/ u("p", {
            className: "dsqjs-footer",
            children: [
                'Powered by ',
                /*#__PURE__*/ u("a", {
                    className: "dsqjs-disqus-logo",
                    href: "https://disqus.com",
                    target: "_blank",
                    rel: "external nofollow noopener noreferrer"
                }),
                ' ',
                "&",
                ' ',
                /*#__PURE__*/ u("a", {
                    className: "dsqjs-dsqjs-logo",
                    href: "https://disqusjs.skk.moe",
                    target: "_blank",
                    children: "DisqusJS"
                })
            ]
        })
    }));

var styles = {"dsqjs":"__dsqjs_1l1du3"};

function e$1(e,o){y(()=>{const t=new AbortController,o=e(t.signal);return ()=>{t.abort(),null==o||o();}},o);}const o$2=e$1;

const o$1=()=>{};

function i(i){const c=K$1(i),m=K$1(o$1);return [t=>{let{children:e}=t;const[n,l]=d(i);return u(c.Provider,{value:n,children:u(m.Provider,{value:l,children:e})})},()=>x(c),()=>x(m),c]}

function getDisqusJsModeDefaultValue() {
    if (typeof window !== 'undefined') {
        const value = localStorage.getItem('dsqjs_mode');
        if (value === 'dsqjs' || value === 'disqus') {
            return value;
        }
    }
    return null;
}
const [ModeProvider, useMode, useSetModeState] = i(getDisqusJsModeDefaultValue());
function useSetMode() {
    const setDisqusJsMode = useSetModeState();
    return q$1((mode)=>{
        setDisqusJsMode(mode);
        void Promise.resolve(()=>{
            if (mode === null) {
                localStorage.removeItem('dsqjs_mode');
            } else {
                localStorage.setItem('dsqjs_mode', mode);
            }
        });
    }, [
        setDisqusJsMode
    ]);
}

const [HasErrorProvider, useHasError, useSetHasError] = i(false);

const DisqusJSLoadMoreCommentsButton = /*#__PURE__*/ M((_param)=>{
    var { isError, isLoading } = _param, restProps = _object_without_properties(_param, [
        "isError",
        "isLoading"
    ]);
    const text = T$1(()=>{
        if (isError) {
            return '加载失败，请重试';
        }
        if (isLoading) {
            return '正在加载...';
        }
        return '加载更多评论';
    }, [
        isError,
        isLoading
    ]);
    return /*#__PURE__*/ u("a", _object_spread_props(_object_spread({}, restProps), {
        id: "dsqjs-load-more",
        className: `dsqjs-load-more ${isError ? 'is-error' : ''}`,
        role: "button",
        children: text
    }));
});
const DisqusJSForceDisqusModeButton = /*#__PURE__*/ M(({ children })=>{
    const setDisqusJsMode = useSetMode();
    return /*#__PURE__*/ u("a", {
        id: "dsqjs-force-disqus",
        className: "dsqjs-msg-btn",
        onClick: ()=>setDisqusJsMode('disqus'),
        children: children
    });
});
const DisqusJSReTestModeButton = /*#__PURE__*/ M(({ children })=>{
    const setDisqusJsMode = useSetMode();
    return /*#__PURE__*/ u("a", {
        id: "dsqjs-test-disqus",
        className: "dsqjs-msg-btn",
        onClick: ()=>setDisqusJsMode(null),
        role: "button",
        children: children
    });
});
const DisqusJSForceDisqusJsModeButton = /*#__PURE__*/ M(({ children })=>{
    const setDisqusJsMode = useSetMode();
    return /*#__PURE__*/ u("a", {
        id: "dsqjs-force-dsqjs",
        className: "dsqjs-msg-btn",
        onClick: ()=>setDisqusJsMode('dsqjs'),
        role: "button",
        children: children
    });
});
const DisqusJSRetryButton = /*#__PURE__*/ M(({ children })=>{
    const setDisqusJsHasError = useSetHasError();
    return /*#__PURE__*/ u("a", {
        id: "dsqjs-reload-dsqjs",
        className: "dsqjs-msg-btn",
        onClick: ()=>setDisqusJsHasError(false),
        role: "button",
        children: children
    });
});

const [MessageProvider, useMessage, useSetMessage] = i(null);

const e="undefined"==typeof window?y:_;

const THREAD_ID = 'disqus_thread';
const EMBED_SCRIPT_ID = 'dsq-embed-scr';
const Disqus = /*#__PURE__*/ M(({ shortname, identifier, url, title })=>{
    const setMsg = useSetMessage();
    const [loaded, setLoaded] = d(false);
    e(()=>setMsg(null));
    y(()=>{
        const clearDisqusInstance = ()=>{
            if (typeof window !== 'undefined') {
                var _window_DISQUS;
                window.disqus_config = undefined;
                const scriptEl = document.getElementById(EMBED_SCRIPT_ID);
                if (scriptEl) {
                    document.head.removeChild(scriptEl);
                    scriptEl.remove();
                }
                (_window_DISQUS = window.DISQUS) === null || _window_DISQUS === void 0 ? void 0 : _window_DISQUS.reset({});
                try {
                    delete window.DISQUS;
                } catch (e) {
                    window.DISQUS = undefined;
                }
                const containerEl = document.getElementById(THREAD_ID);
                if (containerEl) {
                    while(containerEl.hasChildNodes()){
                        if (containerEl.firstChild) {
                            containerEl.firstChild.remove();
                        }
                    }
                }
                document.querySelectorAll('link[href*="disquscdn.com/next"], link[href*="disqus.com/next"], script[src*="disquscdn.com/next/embed"], script[src*="disqus.com/count-data.js"], iframe[title="Disqus"]').forEach((el)=>el.remove());
            }
        };
        if (window.disqus_shortname !== shortname) {
            clearDisqusInstance();
        }
        // eslint-disable-next-line sukka/unicorn/consistent-function-scoping -- scope of "this"
        const getDisqusConfig = ()=>function() {
                if (identifier) {
                    this.page.identifier = identifier;
                }
                if (url) {
                    this.page.url = url;
                }
                if (title) {
                    this.page.title = title;
                }
                this.callbacks.onReady = [
                    ()=>setLoaded(true)
                ];
            };
        if (window.DISQUS && document.getElementById(EMBED_SCRIPT_ID)) {
            window.DISQUS.reset({
                reload: true,
                config: getDisqusConfig()
            });
        } else {
            window.disqus_config = getDisqusConfig();
            window.disqus_shortname = shortname;
            const scriptEl = document.createElement('script');
            scriptEl.id = EMBED_SCRIPT_ID;
            scriptEl.src = `https://${shortname}.disqus.com/embed.js`;
            scriptEl.async = true;
            document.head.appendChild(scriptEl);
        }
        return clearDisqusInstance;
    }, [
        shortname,
        identifier,
        url,
        title
    ]);
    return /*#__PURE__*/ u(k$1, {
        children: [
            /*#__PURE__*/ u("div", {
                id: THREAD_ID,
                children: [
                    "评论完整模式加载中... 如果长时间无法加载，请针对 disq.us | disquscdn.com | disqus.com 启用代理，或切换至",
                    ' ',
                    /*#__PURE__*/ u(DisqusJSForceDisqusJsModeButton, {
                        children: "评论基础模式"
                    })
                ]
            }),
            !loaded && /*#__PURE__*/ u("div", {
                id: "dsqjs-msg",
                children: [
                    "评论完整模式加载中... 如果长时间无法加载，请针对 disq.us | disquscdn.com | disqus.com 启用代理，或切换至",
                    ' ',
                    /*#__PURE__*/ u(DisqusJSForceDisqusJsModeButton, {
                        children: "评论基础模式"
                    })
                ]
            })
        ]
    });
});

const DisqusJSError = /*#__PURE__*/ M(()=>/*#__PURE__*/ u("div", {
        id: "dsqjs-msg",
        children: [
            "评论基础模式加载失败，请",
            ' ',
            /*#__PURE__*/ u(DisqusJSRetryButton, {
                children: "重载"
            }),
            ' ',
            "或",
            ' ',
            /*#__PURE__*/ u(DisqusJSReTestModeButton, {
                children: "尝试完整 Disqus 模式"
            })
        ]
    }));
const DisqusJSCreateThread = /*#__PURE__*/ M(()=>/*#__PURE__*/ u("div", {
        id: "dsqjs-msg",
        children: [
            "当前 Thread 尚未创建。是否切换至",
            ' ',
            /*#__PURE__*/ u(DisqusJSForceDisqusModeButton, {
                children: "完整 Disqus 模式"
            }),
            "？"
        ]
    }));
const DisqusJSNoComment = /*#__PURE__*/ M(({ text })=>/*#__PURE__*/ u("p", {
        className: "dsqjs-no-comment",
        children: text
    }));

function disqusJsApiFetcher(apiKey, url) {
    const Url = new URL(url);
    Url.searchParams.set('api_key', apiKey);
    return fetch(Url.href).then((res)=>res.json());
}
const getTimeStampFromString = (dateString)=>new Date(dateString).getTime();
let domParser = null;
function processCommentMessage(str) {
    const rawHtml = str.replaceAll('a.disquscdn.com', 'c.disquscdn.com').replaceAll(/https?:\/\/disq.us\/url\?url=(.+)%3A[\w-]+&amp;cuid=\d+/g, (_, $1)=>decodeURIComponent($1));
    domParser || (domParser = new DOMParser());
    const doc = domParser.parseFromString(rawHtml, 'text/html');
    // Very basic, but it will do.
    // Any attempt to bypass XSS limitation will be blocked by Disqus' WAF.
    doc.querySelectorAll('script').forEach((script)=>script.remove());
    doc.querySelectorAll('a').forEach((a)=>{
        a.target = '_blank';
        a.rel = 'external noopener nofollow noreferrer';
    });
    return doc.body.innerHTML;
}
const timezoneOffset = new Date().getTimezoneOffset();
const numberPadstart = (num)=>String(num).padStart(2, '0');
function formatDate(str) {
    const utcTimestamp = getTimeStampFromString(str);
    const date = new Date(utcTimestamp - timezoneOffset * 60 * 1000);
    return `${date.getFullYear()}-${numberPadstart(date.getMonth() + 1)}-${numberPadstart(date.getDate())} ${numberPadstart(date.getHours())}:${numberPadstart(date.getMinutes())}`;
}
function checkDomainAccessiblity(domain) {
    return new Promise((resolve, reject)=>{
        const img = new Image();
        const timeout = setTimeout(()=>{
            clear();
            reject();
        }, 3000);
        function handleLoad() {
            clearTimeout(timeout);
            clear();
            resolve();
        }
        function handleError() {
            clearTimeout(timeout);
            clear();
            reject();
        }
        function clear() {
            img.removeEventListener('load', handleLoad);
            img.removeEventListener('error', handleError);
            img.remove();
        }
        img.addEventListener('error', handleError);
        img.addEventListener('load', handleLoad);
        img.src = `https://${domain}/favicon.ico?${Date.now()}=${Date.now()}`;
    });
}

const ConfigContext = K$1(null);
const ConfigProvider = ConfigContext.Provider;
function useConfig() {
    const config = x(ConfigContext);
    if (!config) {
        throw new TypeError('<ConfigProvider /> is missing');
    }
    return config;
}

function DisqusJSPostItem({ comment, children, nesting }) {
    const { admin, adminLabel } = useConfig();
    const profileUrl = comment.author.profileUrl;
    const avatarUrl = processCommentMessage(comment.author.avatar.cache);
    const imgEl = /*#__PURE__*/ u("img", {
        alt: comment.author.username,
        src: avatarUrl
    });
    return /*#__PURE__*/ u("li", {
        id: `comment-${comment.id}`,
        children: [
            /*#__PURE__*/ u("div", {
                className: "dsqjs-post-item dsqjs-clearfix",
                children: [
                    /*#__PURE__*/ u("div", {
                        className: "dsqjs-post-avatar",
                        children: profileUrl ? /*#__PURE__*/ u("a", {
                            href: profileUrl,
                            target: "_blank",
                            rel: "noreferrer noopenner nofollow external",
                            children: imgEl
                        }) : imgEl
                    }),
                    /*#__PURE__*/ u("div", {
                        className: "dsqjs-post-body",
                        children: [
                            /*#__PURE__*/ u("div", {
                                className: "dsqjs-post-header",
                                children: [
                                    profileUrl ? /*#__PURE__*/ u("span", {
                                        className: "dsqjs-post-author",
                                        children: /*#__PURE__*/ u("a", {
                                            href: profileUrl,
                                            target: "_blank",
                                            rel: "noreferrer noopenner nofollow external",
                                            children: comment.author.name
                                        })
                                    }) : /*#__PURE__*/ u("span", {
                                        className: "dsqjs-post-author",
                                        children: comment.author.name
                                    }),
                                    // authorEl admin label
                                    admin === comment.author.username && /*#__PURE__*/ u("span", {
                                        className: "dsqjs-admin-badge",
                                        children: adminLabel
                                    }),
                                    ' ',
                                    /*#__PURE__*/ u("span", {
                                        className: "dsqjs-bullet"
                                    }),
                                    ' ',
                                    comment.createdAt && /*#__PURE__*/ u("span", {
                                        className: "dsqjs-meta",
                                        children: /*#__PURE__*/ u("time", {
                                            children: formatDate(comment.createdAt)
                                        })
                                    })
                                ]
                            }),
                            comment.isDeleted ? /*#__PURE__*/ u("div", {
                                className: "dsqjs-post-content",
                                children: /*#__PURE__*/ u("small", {
                                    children: "此评论已被删除"
                                })
                            }) : /*#__PURE__*/ u("div", {
                                className: "dsqjs-post-content",
                                dangerouslySetInnerHTML: {
                                    __html: processCommentMessage(comment.message)
                                }
                            })
                        ]
                    })
                ]
            }),
            /*#__PURE__*/ u(DisqusJSChildrenPostItems, {
                nesting: nesting,
                children: children
            }),
            comment.hasMore && /*#__PURE__*/ u("p", {
                className: "dsqjs-has-more",
                children: [
                    "切换至 ",
                    /*#__PURE__*/ u(DisqusJSForceDisqusModeButton, {
                        children: "完整 Disqus 模式"
                    }),
                    " 显示更多回复"
                ]
            })
        ]
    });
}
function DisqusJSChildrenPostItems({ children, nesting: currentNesting = 1 }) {
    const { nesting: nestingSetting = 4 } = useConfig();
    if (!children || children.length === 0) return null;
    return /*#__PURE__*/ u("ul", {
        className: `dsqjs-post-list ${currentNesting < nestingSetting ? 'dsqjs-children' : ''}`,
        children: children.map((comment)=>/*#__PURE__*/ _$1(DisqusJSPostItem, _object_spread_props(_object_spread({}, comment), {
                key: comment.comment.id
            })))
    });
}
function createDisqusJSCommentASTItem(comment, allChildrenComments, nesting) {
    return {
        comment,
        children: findChildrenFromComments(allChildrenComments, Number(comment.id), nesting + 1),
        nesting: nesting + 1
    };
}
function findChildrenFromComments(allChildrenComments, parentId, nesting) {
    if (allChildrenComments.length === 0) return null;
    const list = [];
    allChildrenComments.forEach((comment)=>{
        if (comment.parent === parentId) {
            list.unshift(createDisqusJSCommentASTItem(comment, allChildrenComments, nesting));
        }
    });
    return list;
}
function DisqusJSCommentsList({ comments }) {
    const processedComments = T$1(()=>{
        const topLevelComments = [];
        const childComments = [];
        comments.map((comment, i)=>({
                i,
                p: comment.parent,
                d: getTimeStampFromString(comment.createdAt)
            })).sort((a, b)=>a.p && b.p ? a.d - b.d : 0).forEach(({ i })=>{
            (comments[i].parent ? childComments : topLevelComments).push(comments[i]);
        });
        return topLevelComments.map((comment)=>createDisqusJSCommentASTItem(comment, childComments, 0));
    }, [
        comments
    ]);
    return /*#__PURE__*/ u("ul", {
        className: "dsqjs-post-list",
        id: "dsqjs-post-container",
        children: processedComments.map((comment)=>/*#__PURE__*/ _$1(DisqusJSPostItem, _object_spread_props(_object_spread({}, comment), {
                key: comment.comment.id
            })))
    });
}

function t$2(t){return (n,o)=>Math.floor(t()*(o-n+1))+n}let n=t$2(Math.random);

function r(e){return function(t){return 1===t.length?t[0]:t[e(0,t.length-1)]}}let o=r(n);

// We will try to make the used api key as stable as possible
// And if React decides to forget some memoized values, it doesn't matter anyway
function useRandomApiKey(apiKeys) {
    return T$1(()=>{
        if (Array.isArray(apiKeys)) {
            return o(apiKeys);
        }
        return apiKeys;
    }, [
        apiKeys
    ]);
}

function getDisqusJsSortTypeDefaultValue() {
    if (typeof window !== 'undefined') {
        const value = localStorage.getItem('dsqjs_sort');
        if (value === 'popular' || value === 'asc' || value === 'desc') {
            return value;
        }
    }
    return null;
}
const [SortTypeProvider, useSortType, useSetSortType] = i(getDisqusJsSortTypeDefaultValue());

function t$1(t,n){const[o,l]=d(n=[...n]);let r=n.length!==o.length;for(let e=0;e<n.length&&!r;e+=1)o[e]!==n[e]&&(r=true);return r&&(l(n),t()),r}

function t(t){const n=A$1();return n.current||(n.current=t()),n}

function DisqusJSSortTypeRadio({ sortType, onChange, checked, title, label }) {
    return /*#__PURE__*/ u(k$1, {
        children: [
            /*#__PURE__*/ u("input", {
                className: "dsqjs-order-radio",
                id: `dsqjs-order-${sortType}`,
                type: "radio",
                name: "comment-order",
                value: sortType,
                onChange: onChange,
                checked: checked
            }),
            /*#__PURE__*/ u("label", {
                className: "dsqjs-order-label",
                htmlFor: `dsqjs-order-${sortType}`,
                title: title,
                children: label
            })
        ]
    });
}
const DisqusJSSortTypeRadioGroup = /*#__PURE__*/ M(()=>{
    const sortType = useSortType();
    const setSortType = useSetSortType();
    return /*#__PURE__*/ u("div", {
        className: "dsqjs-order",
        children: [
            /*#__PURE__*/ u(DisqusJSSortTypeRadio, {
                checked: sortType === 'desc' || sortType === null,
                sortType: "desc",
                title: "按从新到旧",
                label: "最新",
                onChange: q$1(()=>setSortType('desc'), [
                    setSortType
                ])
            }),
            /*#__PURE__*/ u(DisqusJSSortTypeRadio, {
                checked: sortType === 'asc',
                sortType: "asc",
                title: "按从旧到新",
                label: "最早",
                onChange: q$1(()=>setSortType('asc'), [
                    setSortType
                ])
            }),
            /*#__PURE__*/ u(DisqusJSSortTypeRadio, {
                checked: sortType === 'popular',
                sortType: "popular",
                title: "按评分从高到低",
                label: "最佳",
                onChange: q$1(()=>setSortType('popular'), [
                    setSortType
                ])
            })
        ]
    });
});
const DisqusJSHeader = /*#__PURE__*/ M(({ totalComments, siteName })=>/*#__PURE__*/ u("header", {
        className: "dsqjs-header",
        id: "dsqjs-header",
        children: /*#__PURE__*/ u("nav", {
            className: "dsqjs-nav dsqjs-clearfix",
            children: [
                /*#__PURE__*/ u("ul", {
                    children: [
                        /*#__PURE__*/ u("li", {
                            className: "dsqjs-nav-tab dsqjs-tab-active",
                            children: /*#__PURE__*/ u("span", {
                                children: [
                                    totalComments,
                                    " Comments"
                                ]
                            })
                        }),
                        /*#__PURE__*/ u("li", {
                            className: "dsqjs-nav-tab",
                            children: siteName
                        })
                    ]
                }),
                /*#__PURE__*/ u(DisqusJSSortTypeRadioGroup, {})
            ]
        })
    }));
function DisqusJSPosts({ id }) {
    const { apikey, shortname, api } = useConfig();
    const apiKey = A$1(useRandomApiKey(apikey));
    const [posts, setPosts] = d([]);
    const setError = useSetHasError();
    const sortType = useSortType();
    const [isLoadingMorePosts, setIsLoadingMorePosts] = d(false);
    const [errorWhenLoadingMorePosts, setErrorWhenLoadingMorePosts] = d(false);
    const fetchMorePosts = q$1(async (reset = false)=>{
        if (!id) return;
        setIsLoadingMorePosts(true);
        setErrorWhenLoadingMorePosts(false);
        const lastPost = reset ? null : posts[posts.length - 1];
        if (lastPost && !lastPost.cursor.hasNext) return;
        const url = `${api}3.0/threads/listPostsThreaded?forum=${shortname}&thread=${id}&order=${sortType !== null && sortType !== void 0 ? sortType : 'desc'}${posts.length !== 0 && (lastPost === null || lastPost === void 0 ? void 0 : lastPost.cursor.next) ? `&cursor=${encodeURIComponent(lastPost.cursor.next)}` : ''}`;
        const handleError = ()=>{
            if (reset) {
                setError(true);
                setIsLoadingMorePosts(false);
            } else {
                setErrorWhenLoadingMorePosts(true);
                setIsLoadingMorePosts(false);
            }
        };
        try {
            const newPosts = await disqusJsApiFetcher(apiKey.current, url);
            if (newPosts.code === 0) {
                setPosts((prevPosts)=>(reset ? [] : prevPosts).concat(newPosts));
                setIsLoadingMorePosts(false);
            } else {
                handleError();
            }
        } catch (e) {
            handleError();
        }
    }, [
        id,
        posts,
        api,
        shortname,
        sortType,
        setError
    ]);
    const resetAndFetchFirstPageOfPosts = q$1(()=>fetchMorePosts(true), [
        fetchMorePosts
    ]);
    const fetchNextPageOfPosts = q$1(()=>fetchMorePosts(false), [
        fetchMorePosts
    ]);
    t$1(resetAndFetchFirstPageOfPosts, [
        id,
        sortType
    ]);
    t(resetAndFetchFirstPageOfPosts);
    const comments = T$1(()=>posts.filter(Boolean).flatMap((i)=>i.response), [
        posts
    ]);
    if (posts.length > 0) {
        var _posts_;
        return /*#__PURE__*/ u(k$1, {
            children: [
                /*#__PURE__*/ u(DisqusJSCommentsList, {
                    comments: comments
                }),
                ((_posts_ = posts[posts.length - 1]) === null || _posts_ === void 0 ? void 0 : _posts_.cursor.hasNext) && /*#__PURE__*/ u(DisqusJSLoadMoreCommentsButton, {
                    isLoading: isLoadingMorePosts,
                    isError: errorWhenLoadingMorePosts,
                    onClick: isLoadingMorePosts ? undefined : fetchNextPageOfPosts
                })
            ]
        });
    }
    return null;
}
function DisqusJSThread() {
    const { apikey: $apikey, identifier: $identifier, shortname, api, siteName, nocomment } = useConfig();
    const apiKey = A$1(useRandomApiKey($apikey));
    const [thread, setThread] = d(null);
    const setError = useSetHasError();
    const identifier = typeof window === 'undefined' ? $identifier !== null && $identifier !== void 0 ? $identifier : null : $identifier !== null && $identifier !== void 0 ? $identifier : document.location.origin + document.location.pathname + document.location.search;
    const fetchThread = q$1(async ()=>{
        try {
            const thread = await disqusJsApiFetcher(apiKey.current, `${api}3.0/threads/list.json?forum=${encodeURIComponent(shortname)}&thread=${encodeURIComponent(`ident:${identifier}`)}`);
            if (thread.code === 0) {
                setThread(thread);
            } else {
                setError(true);
            }
        } catch (e) {
            setError(true);
        }
    }, [
        api,
        apiKey,
        identifier,
        setError,
        setThread,
        shortname
    ]);
    const setMsg = useSetMessage();
    const fetchThreadRef = A$1(null);
    y(()=>{
        const actionElement = /*#__PURE__*/ u(k$1, {
            children: [
                /*#__PURE__*/ u(DisqusJSReTestModeButton, {
                    children: "尝试完整 Disqus 模式"
                }),
                " | ",
                /*#__PURE__*/ u(DisqusJSForceDisqusModeButton, {
                    children: "强制完整 Disqus 模式"
                })
            ]
        });
        if (fetchThreadRef.current === identifier) {
            setMsg(/*#__PURE__*/ u(k$1, {
                children: [
                    "你可能无法访问 Disqus，已启用评论基础模式。如需完整体验请针对 disq.us | disquscdn.com | disqus.com 启用代理并",
                    ' ',
                    actionElement
                ]
            }));
        } else {
            setMsg(/*#__PURE__*/ u(k$1, {
                children: [
                    "评论基础模式加载中... 如需完整体验请针对 disq.us | disquscdn.com | disqus.com 启用代理并",
                    ' ',
                    actionElement
                ]
            }));
            fetchThreadRef.current = identifier;
            void fetchThread();
        }
    }, [
        thread,
        fetchThread,
        identifier,
        setMsg,
        shortname,
        api
    ]);
    if (!thread) {
        return null;
    }
    if (thread.response.length !== 1) {
        return /*#__PURE__*/ u(DisqusJSCreateThread, {});
    }
    const matchedThread = thread.response[0];
    const totalComments = matchedThread.posts;
    return /*#__PURE__*/ u(k$1, {
        children: [
            /*#__PURE__*/ u(DisqusJSHeader, {
                totalComments: totalComments,
                siteName: siteName !== null && siteName !== void 0 ? siteName : ''
            }),
            totalComments === 0 ? /*#__PURE__*/ u(DisqusJSNoComment, {
                text: nocomment !== null && nocomment !== void 0 ? nocomment : '这里空荡荡的，一个人都没有'
            }) : /*#__PURE__*/ u(DisqusJSPosts, {
                id: matchedThread.id
            })
        ]
    });
}

function DisqusJSEntry() {
    const setMsg = useSetMessage();
    const mode = useMode();
    const setMode = useSetMode();
    const { shortname, identifier, url, title } = useConfig();
    o$2((signal)=>{
        if (mode === 'disqus' || mode === 'dsqjs') {
            return;
        }
        setMsg('正在检查 Disqus 能否访问...');
        Promise.all([
            'disqus.com',
            `${shortname}.disqus.com`
        ].map(checkDomainAccessiblity)).then(()=>{
            if (!signal.aborted) {
                setMode('disqus');
            }
        }).catch(()=>{
            if (!signal.aborted) {
                setMode('dsqjs');
            }
        });
    }, [
        mode,
        setMode,
        setMsg,
        shortname
    ]);
    const disqusJsHasError = useHasError();
    const msg = useMessage();
    if (disqusJsHasError) {
        return /*#__PURE__*/ u(DisqusJSError, {});
    }
    return /*#__PURE__*/ u(k$1, {
        children: [
            msg != null && /*#__PURE__*/ u("div", {
                id: "dsqjs-msg",
                children: msg
            }),
            mode === 'disqus' && /*#__PURE__*/ u(Disqus, {
                shortname: shortname,
                identifier: identifier,
                url: url,
                title: title
            }),
            mode === 'dsqjs' && /*#__PURE__*/ u(DisqusJSThread, {})
        ]
    });
}

const DisqusJS$1 = /*#__PURE__*/ D((_param, ref)=>{
    var { shortname, siteName, identifier, url, title, api, apikey, nesting, nocomment, admin, adminLabel, className } = _param, rest = _object_without_properties(_param, [
        "shortname",
        "siteName",
        "identifier",
        "url",
        "title",
        "api",
        "apikey",
        "nesting",
        "nocomment",
        "admin",
        "adminLabel",
        "className"
    ]);
    const contexts = T$1(()=>[
            /*#__PURE__*/ u(ConfigProvider, {
                value: {
                    shortname,
                    siteName,
                    identifier,
                    url,
                    title,
                    api,
                    apikey,
                    nesting,
                    nocomment,
                    admin,
                    adminLabel
                }
            }, "config"),
            /*#__PURE__*/ u(ModeProvider, {}, "mode"),
            /*#__PURE__*/ u(SortTypeProvider, {}, "sortType"),
            /*#__PURE__*/ u(HasErrorProvider, {}, "hasError"),
            /*#__PURE__*/ u(MessageProvider, {}, "msg")
        ], [
        admin,
        adminLabel,
        api,
        apikey,
        identifier,
        nesting,
        nocomment,
        shortname,
        siteName,
        title,
        url
    ]);
    if (o$3()) {
        return /*#__PURE__*/ u("div", _object_spread_props(_object_spread({
            ref: ref
        }, rest), {
            className: `${styles.dsqjs} ${className !== null && className !== void 0 ? className : ''}`,
            children: /*#__PURE__*/ u(t$3, {
                contexts: contexts,
                children: /*#__PURE__*/ u("section", {
                    id: "dsqjs",
                    children: [
                        /*#__PURE__*/ u(DisqusJSEntry, {}),
                        /*#__PURE__*/ u(DisqusJSFooter, {})
                    ]
                })
            })
        }));
    }
    return null;
});

class DisqusJS {
    render(el) {
        let container;
        if (el) {
            if (typeof el === 'string') {
                container = document.querySelector(el);
            } else {
                container = el;
            }
        } else {
            container = document.getElementById('disqusjs');
        }
        if (container) {
            this.container = container;
            E$1(/*#__PURE__*/ u(DisqusJS$1, _object_spread({}, this.config)), container);
        }
    }
    destroy() {
        if (this.container) {
            // https://github.com/preactjs/preact/blob/40f7c6592b4ed96fe9c6615e43e3d9815e566291/compat/src/index.js#L67-L78
            E$1(null, this.container);
        }
    }
    constructor(config){
        _define_property(this, "config", void 0);
        _define_property(this, "container", void 0);
        this.config = config;
    }
}

export { DisqusJS as default };
