'use strict';

var jsxRuntime = require('react/jsx-runtime');
var useIsClient = require('foxact/use-is-client');
var composeContextProvider = require('foxact/compose-context-provider');
var react = require('react');
var useAbortableEffect = require('foxact/use-abortable-effect');
var contextState = require('foxact/context-state');
var useIsomorphicLayoutEffect = require('foxact/use-isomorphic-layout-effect');
var pickRandom = require('foxts/pick-random');
var useComponentWillReceiveUpdate = require('foxact/use-component-will-receive-update');
var useSingleton = require('foxact/use-singleton');

const DisqusJSFooter = /*#__PURE__*/ react.memo(()=>/*#__PURE__*/ jsxRuntime.jsx("footer", {
        className: "dsqjs-footer-container",
        children: /*#__PURE__*/ jsxRuntime.jsxs("p", {
            className: "dsqjs-footer",
            children: [
                'Powered by ',
                /*#__PURE__*/ jsxRuntime.jsx("a", {
                    className: "dsqjs-disqus-logo",
                    href: "https://disqus.com",
                    target: "_blank",
                    rel: "external nofollow noopener noreferrer"
                }),
                ' ',
                "&",
                ' ',
                /*#__PURE__*/ jsxRuntime.jsx("a", {
                    className: "dsqjs-dsqjs-logo",
                    href: "https://disqusjs.skk.moe",
                    target: "_blank",
                    children: "DisqusJS"
                })
            ]
        })
    }));
if (process.env.NODE_ENV !== 'production') {
    DisqusJSFooter.displayName = 'DisqusJSFooter';
}

var styles = {"dsqjs":"__dsqjs_1l1du3"};

function getDisqusJsModeDefaultValue() {
    if (typeof window !== 'undefined') {
        const value = localStorage.getItem('dsqjs_mode');
        if (value === 'dsqjs' || value === 'disqus') {
            return value;
        }
    }
    return null;
}
const [ModeProvider, useMode, useSetModeState] = contextState.createContextState(getDisqusJsModeDefaultValue());
function useSetMode() {
    const setDisqusJsMode = useSetModeState();
    return react.useCallback((mode)=>{
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

const [HasErrorProvider, useHasError, useSetHasError] = contextState.createContextState(false);

const DisqusJSLoadMoreCommentsButton = /*#__PURE__*/ react.memo(({ isError, isLoading, ...restProps })=>{
    const text = react.useMemo(()=>{
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
    return /*#__PURE__*/ jsxRuntime.jsx("a", {
        ...restProps,
        id: "dsqjs-load-more",
        className: `dsqjs-load-more ${isError ? 'is-error' : ''}`,
        role: "button",
        children: text
    });
});
if (process.env.NODE_ENV !== 'production') {
    DisqusJSLoadMoreCommentsButton.displayName = 'DisqusJSLoadMoreCommentsButton';
}
const DisqusJSForceDisqusModeButton = /*#__PURE__*/ react.memo(({ children })=>{
    const setDisqusJsMode = useSetMode();
    return /*#__PURE__*/ jsxRuntime.jsx("a", {
        id: "dsqjs-force-disqus",
        className: "dsqjs-msg-btn",
        onClick: ()=>setDisqusJsMode('disqus'),
        children: children
    });
});
if (process.env.NODE_ENV !== 'production') {
    DisqusJSForceDisqusModeButton.displayName = 'DisqusJSForceDisqusModeButton';
}
const DisqusJSReTestModeButton = /*#__PURE__*/ react.memo(({ children })=>{
    const setDisqusJsMode = useSetMode();
    return /*#__PURE__*/ jsxRuntime.jsx("a", {
        id: "dsqjs-test-disqus",
        className: "dsqjs-msg-btn",
        onClick: ()=>setDisqusJsMode(null),
        role: "button",
        children: children
    });
});
if (process.env.NODE_ENV !== 'production') {
    DisqusJSReTestModeButton.displayName = 'DisqusJSRetestModeButton';
}
const DisqusJSForceDisqusJsModeButton = /*#__PURE__*/ react.memo(({ children })=>{
    const setDisqusJsMode = useSetMode();
    return /*#__PURE__*/ jsxRuntime.jsx("a", {
        id: "dsqjs-force-dsqjs",
        className: "dsqjs-msg-btn",
        onClick: ()=>setDisqusJsMode('dsqjs'),
        role: "button",
        children: children
    });
});
if (process.env.NODE_ENV !== 'production') {
    DisqusJSForceDisqusJsModeButton.displayName = 'DisqusJSForceDisqusJsModeButton';
}
const DisqusJSRetryButton = /*#__PURE__*/ react.memo(({ children })=>{
    const setDisqusJsHasError = useSetHasError();
    return /*#__PURE__*/ jsxRuntime.jsx("a", {
        id: "dsqjs-reload-dsqjs",
        className: "dsqjs-msg-btn",
        onClick: ()=>setDisqusJsHasError(false),
        role: "button",
        children: children
    });
});
if (process.env.NODE_ENV !== 'production') {
    DisqusJSRetryButton.displayName = 'DisqusJSRetryButton';
}

const [MessageProvider, useMessage, useSetMessage] = contextState.createContextState(null);

const THREAD_ID = 'disqus_thread';
const EMBED_SCRIPT_ID = 'dsq-embed-scr';
const Disqus = /*#__PURE__*/ react.memo(({ shortname, identifier, url, title })=>{
    const setMsg = useSetMessage();
    const [loaded, setLoaded] = react.useState(false);
    useIsomorphicLayoutEffect.useIsomorphicLayoutEffect(()=>setMsg(null));
    react.useEffect(()=>{
        const clearDisqusInstance = ()=>{
            if (typeof window !== 'undefined') {
                window.disqus_config = undefined;
                const scriptEl = document.getElementById(EMBED_SCRIPT_ID);
                if (scriptEl) {
                    document.head.removeChild(scriptEl);
                    scriptEl.remove();
                }
                window.DISQUS?.reset({});
                try {
                    delete window.DISQUS;
                } catch  {
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
    return /*#__PURE__*/ jsxRuntime.jsxs(jsxRuntime.Fragment, {
        children: [
            /*#__PURE__*/ jsxRuntime.jsxs("div", {
                id: THREAD_ID,
                children: [
                    "评论完整模式加载中... 如果长时间无法加载，请针对 disq.us | disquscdn.com | disqus.com 启用代理，或切换至",
                    ' ',
                    /*#__PURE__*/ jsxRuntime.jsx(DisqusJSForceDisqusJsModeButton, {
                        children: "评论基础模式"
                    })
                ]
            }),
            !loaded && /*#__PURE__*/ jsxRuntime.jsxs("div", {
                id: "dsqjs-msg",
                children: [
                    "评论完整模式加载中... 如果长时间无法加载，请针对 disq.us | disquscdn.com | disqus.com 启用代理，或切换至",
                    ' ',
                    /*#__PURE__*/ jsxRuntime.jsx(DisqusJSForceDisqusJsModeButton, {
                        children: "评论基础模式"
                    })
                ]
            })
        ]
    });
});
if (process.env.NODE_ENV !== 'production') {
    Disqus.displayName = 'Disqus';
}

const DisqusJSError = /*#__PURE__*/ react.memo(()=>/*#__PURE__*/ jsxRuntime.jsxs("div", {
        id: "dsqjs-msg",
        children: [
            "评论基础模式加载失败，请",
            ' ',
            /*#__PURE__*/ jsxRuntime.jsx(DisqusJSRetryButton, {
                children: "重载"
            }),
            ' ',
            "或",
            ' ',
            /*#__PURE__*/ jsxRuntime.jsx(DisqusJSReTestModeButton, {
                children: "尝试完整 Disqus 模式"
            })
        ]
    }));
const DisqusJSCreateThread = /*#__PURE__*/ react.memo(()=>/*#__PURE__*/ jsxRuntime.jsxs("div", {
        id: "dsqjs-msg",
        children: [
            "当前 Thread 尚未创建。是否切换至",
            ' ',
            /*#__PURE__*/ jsxRuntime.jsx(DisqusJSForceDisqusModeButton, {
                children: "完整 Disqus 模式"
            }),
            "？"
        ]
    }));
const DisqusJSNoComment = /*#__PURE__*/ react.memo(({ text })=>/*#__PURE__*/ jsxRuntime.jsx("p", {
        className: "dsqjs-no-comment",
        children: text
    }));
if (process.env.NODE_ENV !== 'production') {
    DisqusJSError.displayName = 'DisqusJSError';
    DisqusJSCreateThread.displayName = 'DisqusJSCreateThread';
    DisqusJSNoComment.displayName = 'DisqusJSNoComment';
}

function disqusJsApiFetcher(apiKey, url) {
    const Url = new URL(url);
    Url.searchParams.set('api_key', apiKey);
    return fetch(Url.href).then((res)=>res.json());
}
const getTimeStampFromString = (dateString)=>new Date(dateString).getTime();
let domParser = null;
function processCommentMessage(str) {
    const rawHtml = str.replaceAll('a.disquscdn.com', 'c.disquscdn.com').replaceAll(/https?:\/\/disq.us\/url\?url=(.+)%3A[\w-]+&amp;cuid=\d+/g, (_, $1)=>decodeURIComponent($1));
    domParser ||= new DOMParser();
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

const ConfigContext = react.createContext(null);
const ConfigProvider = ConfigContext.Provider;
function useConfig() {
    const config = react.useContext(ConfigContext);
    if (!config) {
        throw new TypeError('<ConfigProvider /> is missing');
    }
    return config;
}

function DisqusJSPostItem({ comment, children, nesting }) {
    const { admin, adminLabel } = useConfig();
    const profileUrl = comment.author.profileUrl;
    const avatarUrl = processCommentMessage(comment.author.avatar.cache);
    const imgEl = /*#__PURE__*/ jsxRuntime.jsx("img", {
        alt: comment.author.username,
        src: avatarUrl
    });
    return /*#__PURE__*/ jsxRuntime.jsxs("li", {
        id: `comment-${comment.id}`,
        children: [
            /*#__PURE__*/ jsxRuntime.jsxs("div", {
                className: "dsqjs-post-item dsqjs-clearfix",
                children: [
                    /*#__PURE__*/ jsxRuntime.jsx("div", {
                        className: "dsqjs-post-avatar",
                        children: profileUrl ? /*#__PURE__*/ jsxRuntime.jsx("a", {
                            href: profileUrl,
                            target: "_blank",
                            rel: "noreferrer noopenner nofollow external",
                            children: imgEl
                        }) : imgEl
                    }),
                    /*#__PURE__*/ jsxRuntime.jsxs("div", {
                        className: "dsqjs-post-body",
                        children: [
                            /*#__PURE__*/ jsxRuntime.jsxs("div", {
                                className: "dsqjs-post-header",
                                children: [
                                    profileUrl ? /*#__PURE__*/ jsxRuntime.jsx("span", {
                                        className: "dsqjs-post-author",
                                        children: /*#__PURE__*/ jsxRuntime.jsx("a", {
                                            href: profileUrl,
                                            target: "_blank",
                                            rel: "noreferrer noopenner nofollow external",
                                            children: comment.author.name
                                        })
                                    }) : /*#__PURE__*/ jsxRuntime.jsx("span", {
                                        className: "dsqjs-post-author",
                                        children: comment.author.name
                                    }),
                                    // authorEl admin label
                                    admin === comment.author.username && /*#__PURE__*/ jsxRuntime.jsx("span", {
                                        className: "dsqjs-admin-badge",
                                        children: adminLabel
                                    }),
                                    ' ',
                                    /*#__PURE__*/ jsxRuntime.jsx("span", {
                                        className: "dsqjs-bullet"
                                    }),
                                    ' ',
                                    comment.createdAt && /*#__PURE__*/ jsxRuntime.jsx("span", {
                                        className: "dsqjs-meta",
                                        children: /*#__PURE__*/ jsxRuntime.jsx("time", {
                                            children: formatDate(comment.createdAt)
                                        })
                                    })
                                ]
                            }),
                            comment.isDeleted ? /*#__PURE__*/ jsxRuntime.jsx("div", {
                                className: "dsqjs-post-content",
                                children: /*#__PURE__*/ jsxRuntime.jsx("small", {
                                    children: "此评论已被删除"
                                })
                            }) : /*#__PURE__*/ jsxRuntime.jsx("div", {
                                className: "dsqjs-post-content",
                                dangerouslySetInnerHTML: {
                                    __html: processCommentMessage(comment.message)
                                }
                            })
                        ]
                    })
                ]
            }),
            /*#__PURE__*/ jsxRuntime.jsx(DisqusJSChildrenPostItems, {
                nesting: nesting,
                children: children
            }),
            comment.hasMore && /*#__PURE__*/ jsxRuntime.jsxs("p", {
                className: "dsqjs-has-more",
                children: [
                    "切换至 ",
                    /*#__PURE__*/ jsxRuntime.jsx(DisqusJSForceDisqusModeButton, {
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
    return /*#__PURE__*/ jsxRuntime.jsx("ul", {
        className: `dsqjs-post-list ${currentNesting < nestingSetting ? 'dsqjs-children' : ''}`,
        children: children.map((comment)=>/*#__PURE__*/ react.createElement(DisqusJSPostItem, {
                ...comment,
                key: comment.comment.id
            }))
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
    const processedComments = react.useMemo(()=>{
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
    return /*#__PURE__*/ jsxRuntime.jsx("ul", {
        className: "dsqjs-post-list",
        id: "dsqjs-post-container",
        children: processedComments.map((comment)=>/*#__PURE__*/ react.createElement(DisqusJSPostItem, {
                ...comment,
                key: comment.comment.id
            }))
    });
}

// We will try to make the used api key as stable as possible
// And if React decides to forget some memoized values, it doesn't matter anyway
function useRandomApiKey(apiKeys) {
    return react.useMemo(()=>{
        if (Array.isArray(apiKeys)) {
            return pickRandom.pickOne(apiKeys);
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
const [SortTypeProvider, useSortType, useSetSortType] = contextState.createContextState(getDisqusJsSortTypeDefaultValue());

function DisqusJSSortTypeRadio({ sortType, onChange, checked, title, label }) {
    return /*#__PURE__*/ jsxRuntime.jsxs(jsxRuntime.Fragment, {
        children: [
            /*#__PURE__*/ jsxRuntime.jsx("input", {
                className: "dsqjs-order-radio",
                id: `dsqjs-order-${sortType}`,
                type: "radio",
                name: "comment-order",
                value: sortType,
                onChange: onChange,
                checked: checked
            }),
            /*#__PURE__*/ jsxRuntime.jsx("label", {
                className: "dsqjs-order-label",
                htmlFor: `dsqjs-order-${sortType}`,
                title: title,
                children: label
            })
        ]
    });
}
const DisqusJSSortTypeRadioGroup = /*#__PURE__*/ react.memo(()=>{
    const sortType = useSortType();
    const setSortType = useSetSortType();
    return /*#__PURE__*/ jsxRuntime.jsxs("div", {
        className: "dsqjs-order",
        children: [
            /*#__PURE__*/ jsxRuntime.jsx(DisqusJSSortTypeRadio, {
                checked: sortType === 'desc' || sortType === null,
                sortType: "desc",
                title: "按从新到旧",
                label: "最新",
                onChange: react.useCallback(()=>setSortType('desc'), [
                    setSortType
                ])
            }),
            /*#__PURE__*/ jsxRuntime.jsx(DisqusJSSortTypeRadio, {
                checked: sortType === 'asc',
                sortType: "asc",
                title: "按从旧到新",
                label: "最早",
                onChange: react.useCallback(()=>setSortType('asc'), [
                    setSortType
                ])
            }),
            /*#__PURE__*/ jsxRuntime.jsx(DisqusJSSortTypeRadio, {
                checked: sortType === 'popular',
                sortType: "popular",
                title: "按评分从高到低",
                label: "最佳",
                onChange: react.useCallback(()=>setSortType('popular'), [
                    setSortType
                ])
            })
        ]
    });
});
if (process.env.NODE_ENV !== 'production') {
    DisqusJSSortTypeRadioGroup.displayName = 'DisqusJSSortTypeRadio';
}
const DisqusJSHeader = /*#__PURE__*/ react.memo(({ totalComments, siteName })=>/*#__PURE__*/ jsxRuntime.jsx("header", {
        className: "dsqjs-header",
        id: "dsqjs-header",
        children: /*#__PURE__*/ jsxRuntime.jsxs("nav", {
            className: "dsqjs-nav dsqjs-clearfix",
            children: [
                /*#__PURE__*/ jsxRuntime.jsxs("ul", {
                    children: [
                        /*#__PURE__*/ jsxRuntime.jsx("li", {
                            className: "dsqjs-nav-tab dsqjs-tab-active",
                            children: /*#__PURE__*/ jsxRuntime.jsxs("span", {
                                children: [
                                    totalComments,
                                    " Comments"
                                ]
                            })
                        }),
                        /*#__PURE__*/ jsxRuntime.jsx("li", {
                            className: "dsqjs-nav-tab",
                            children: siteName
                        })
                    ]
                }),
                /*#__PURE__*/ jsxRuntime.jsx(DisqusJSSortTypeRadioGroup, {})
            ]
        })
    }));
if (process.env.NODE_ENV !== 'production') {
    DisqusJSHeader.displayName = 'DisqusJSHeader';
}
function DisqusJSPosts({ id }) {
    const { apikey, shortname, api } = useConfig();
    const apiKey = react.useRef(useRandomApiKey(apikey));
    const [posts, setPosts] = react.useState([]);
    const setError = useSetHasError();
    const sortType = useSortType();
    const [isLoadingMorePosts, setIsLoadingMorePosts] = react.useState(false);
    const [errorWhenLoadingMorePosts, setErrorWhenLoadingMorePosts] = react.useState(false);
    const fetchMorePosts = react.useCallback(async (reset = false)=>{
        if (!id) return;
        setIsLoadingMorePosts(true);
        setErrorWhenLoadingMorePosts(false);
        const lastPost = reset ? null : posts[posts.length - 1];
        if (lastPost && !lastPost.cursor.hasNext) return;
        const url = `${api}3.0/threads/listPostsThreaded?forum=${shortname}&thread=${id}&order=${sortType ?? 'desc'}${posts.length !== 0 && lastPost?.cursor.next ? `&cursor=${encodeURIComponent(lastPost.cursor.next)}` : ''}`;
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
        } catch  {
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
    const resetAndFetchFirstPageOfPosts = react.useCallback(()=>fetchMorePosts(true), [
        fetchMorePosts
    ]);
    const fetchNextPageOfPosts = react.useCallback(()=>fetchMorePosts(false), [
        fetchMorePosts
    ]);
    useComponentWillReceiveUpdate.useComponentWillReceiveUpdate(resetAndFetchFirstPageOfPosts, [
        id,
        sortType
    ]);
    useSingleton.useSingleton(resetAndFetchFirstPageOfPosts);
    const comments = react.useMemo(()=>posts.filter(Boolean).flatMap((i)=>i.response), [
        posts
    ]);
    if (posts.length > 0) {
        return /*#__PURE__*/ jsxRuntime.jsxs(jsxRuntime.Fragment, {
            children: [
                /*#__PURE__*/ jsxRuntime.jsx(DisqusJSCommentsList, {
                    comments: comments
                }),
                posts[posts.length - 1]?.cursor.hasNext && /*#__PURE__*/ jsxRuntime.jsx(DisqusJSLoadMoreCommentsButton, {
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
    const apiKey = react.useRef(useRandomApiKey($apikey));
    const [thread, setThread] = react.useState(null);
    const setError = useSetHasError();
    const identifier = typeof window === 'undefined' ? $identifier ?? null : $identifier ?? document.location.origin + document.location.pathname + document.location.search;
    const fetchThread = react.useCallback(async ()=>{
        try {
            const thread = await disqusJsApiFetcher(apiKey.current, `${api}3.0/threads/list.json?forum=${encodeURIComponent(shortname)}&thread=${encodeURIComponent(`ident:${identifier}`)}`);
            if (thread.code === 0) {
                setThread(thread);
            } else {
                setError(true);
            }
        } catch  {
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
    const fetchThreadRef = react.useRef(null);
    react.useEffect(()=>{
        const actionElement = /*#__PURE__*/ jsxRuntime.jsxs(jsxRuntime.Fragment, {
            children: [
                /*#__PURE__*/ jsxRuntime.jsx(DisqusJSReTestModeButton, {
                    children: "尝试完整 Disqus 模式"
                }),
                " | ",
                /*#__PURE__*/ jsxRuntime.jsx(DisqusJSForceDisqusModeButton, {
                    children: "强制完整 Disqus 模式"
                })
            ]
        });
        if (fetchThreadRef.current === identifier) {
            setMsg(/*#__PURE__*/ jsxRuntime.jsxs(jsxRuntime.Fragment, {
                children: [
                    "你可能无法访问 Disqus，已启用评论基础模式。如需完整体验请针对 disq.us | disquscdn.com | disqus.com 启用代理并",
                    ' ',
                    actionElement
                ]
            }));
        } else {
            setMsg(/*#__PURE__*/ jsxRuntime.jsxs(jsxRuntime.Fragment, {
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
        return /*#__PURE__*/ jsxRuntime.jsx(DisqusJSCreateThread, {});
    }
    const matchedThread = thread.response[0];
    const totalComments = matchedThread.posts;
    return /*#__PURE__*/ jsxRuntime.jsxs(jsxRuntime.Fragment, {
        children: [
            /*#__PURE__*/ jsxRuntime.jsx(DisqusJSHeader, {
                totalComments: totalComments,
                siteName: siteName ?? ''
            }),
            totalComments === 0 ? /*#__PURE__*/ jsxRuntime.jsx(DisqusJSNoComment, {
                text: nocomment ?? '这里空荡荡的，一个人都没有'
            }) : /*#__PURE__*/ jsxRuntime.jsx(DisqusJSPosts, {
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
    useAbortableEffect.useEffect((signal)=>{
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
        return /*#__PURE__*/ jsxRuntime.jsx(DisqusJSError, {});
    }
    return /*#__PURE__*/ jsxRuntime.jsxs(jsxRuntime.Fragment, {
        children: [
            msg != null && /*#__PURE__*/ jsxRuntime.jsx("div", {
                id: "dsqjs-msg",
                children: msg
            }),
            mode === 'disqus' && /*#__PURE__*/ jsxRuntime.jsx(Disqus, {
                shortname: shortname,
                identifier: identifier,
                url: url,
                title: title
            }),
            mode === 'dsqjs' && /*#__PURE__*/ jsxRuntime.jsx(DisqusJSThread, {})
        ]
    });
}

const DisqusJS = /*#__PURE__*/ react.forwardRef(({ shortname, siteName, identifier, url, title, api, apikey, nesting, nocomment, admin, adminLabel, className, ...rest }, ref)=>{
    const contexts = react.useMemo(()=>[
            /*#__PURE__*/ jsxRuntime.jsx(ConfigProvider, {
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
            /*#__PURE__*/ jsxRuntime.jsx(ModeProvider, {}, "mode"),
            /*#__PURE__*/ jsxRuntime.jsx(SortTypeProvider, {}, "sortType"),
            /*#__PURE__*/ jsxRuntime.jsx(HasErrorProvider, {}, "hasError"),
            /*#__PURE__*/ jsxRuntime.jsx(MessageProvider, {}, "msg")
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
    if (useIsClient.useIsClient()) {
        return /*#__PURE__*/ jsxRuntime.jsx("div", {
            ref: ref,
            ...rest,
            className: `${styles.dsqjs} ${className ?? ''}`,
            children: /*#__PURE__*/ jsxRuntime.jsx(composeContextProvider.ComposeContextProvider, {
                contexts: contexts,
                children: /*#__PURE__*/ jsxRuntime.jsxs("section", {
                    id: "dsqjs",
                    children: [
                        /*#__PURE__*/ jsxRuntime.jsx(DisqusJSEntry, {}),
                        /*#__PURE__*/ jsxRuntime.jsx(DisqusJSFooter, {})
                    ]
                })
            })
        });
    }
    return null;
});

exports.DisqusJS = DisqusJS;
