import { jsx, jsxs, Fragment } from 'react/jsx-runtime';
import { useIsClient } from 'foxact/use-is-client';
import { ComposeContextProvider } from 'foxact/compose-context-provider';
import { memo, useCallback, useMemo, useState, useEffect, createContext, useContext, createElement, useRef, forwardRef } from 'react';
import { useEffect as useEffect$1 } from 'foxact/use-abortable-effect';
import { createContextState } from 'foxact/context-state';
import { useIsomorphicLayoutEffect } from 'foxact/use-isomorphic-layout-effect';
import { pickOne } from 'foxts/pick-random';
import { useComponentWillReceiveUpdate } from 'foxact/use-component-will-receive-update';
import { useSingleton } from 'foxact/use-singleton';

const DisqusJSFooter = /*#__PURE__*/ memo(()=>/*#__PURE__*/ jsx("footer", {
        className: "dsqjs-footer-container",
        children: /*#__PURE__*/ jsxs("p", {
            className: "dsqjs-footer",
            children: [
                'Powered by ',
                /*#__PURE__*/ jsx("a", {
                    className: "dsqjs-disqus-logo",
                    href: "https://disqus.com",
                    target: "_blank",
                    rel: "external nofollow noopener noreferrer"
                }),
                ' ',
                "&",
                ' ',
                /*#__PURE__*/ jsx("a", {
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
const [ModeProvider, useMode, useSetModeState] = createContextState(getDisqusJsModeDefaultValue());
function useSetMode() {
    const setDisqusJsMode = useSetModeState();
    return useCallback((mode)=>{
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

const [HasErrorProvider, useHasError, useSetHasError] = createContextState(false);

const DisqusJSLoadMoreCommentsButton = /*#__PURE__*/ memo(({ isError, isLoading, ...restProps })=>{
    const text = useMemo(()=>{
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
    return /*#__PURE__*/ jsx("a", {
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
const DisqusJSForceDisqusModeButton = /*#__PURE__*/ memo(({ children })=>{
    const setDisqusJsMode = useSetMode();
    return /*#__PURE__*/ jsx("a", {
        id: "dsqjs-force-disqus",
        className: "dsqjs-msg-btn",
        onClick: ()=>setDisqusJsMode('disqus'),
        children: children
    });
});
if (process.env.NODE_ENV !== 'production') {
    DisqusJSForceDisqusModeButton.displayName = 'DisqusJSForceDisqusModeButton';
}
const DisqusJSReTestModeButton = /*#__PURE__*/ memo(({ children })=>{
    const setDisqusJsMode = useSetMode();
    return /*#__PURE__*/ jsx("a", {
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
const DisqusJSForceDisqusJsModeButton = /*#__PURE__*/ memo(({ children })=>{
    const setDisqusJsMode = useSetMode();
    return /*#__PURE__*/ jsx("a", {
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
const DisqusJSRetryButton = /*#__PURE__*/ memo(({ children })=>{
    const setDisqusJsHasError = useSetHasError();
    return /*#__PURE__*/ jsx("a", {
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

const [MessageProvider, useMessage, useSetMessage] = createContextState(null);

const THREAD_ID = 'disqus_thread';
const EMBED_SCRIPT_ID = 'dsq-embed-scr';
const Disqus = /*#__PURE__*/ memo(({ shortname, identifier, url, title })=>{
    const setMsg = useSetMessage();
    const [loaded, setLoaded] = useState(false);
    useIsomorphicLayoutEffect(()=>setMsg(null));
    useEffect(()=>{
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
    return /*#__PURE__*/ jsxs(Fragment, {
        children: [
            /*#__PURE__*/ jsxs("div", {
                id: THREAD_ID,
                children: [
                    "评论完整模式加载中... 如果长时间无法加载，请针对 disq.us | disquscdn.com | disqus.com 启用代理，或切换至",
                    ' ',
                    /*#__PURE__*/ jsx(DisqusJSForceDisqusJsModeButton, {
                        children: "评论基础模式"
                    })
                ]
            }),
            !loaded && /*#__PURE__*/ jsxs("div", {
                id: "dsqjs-msg",
                children: [
                    "评论完整模式加载中... 如果长时间无法加载，请针对 disq.us | disquscdn.com | disqus.com 启用代理，或切换至",
                    ' ',
                    /*#__PURE__*/ jsx(DisqusJSForceDisqusJsModeButton, {
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

const DisqusJSError = /*#__PURE__*/ memo(()=>/*#__PURE__*/ jsxs("div", {
        id: "dsqjs-msg",
        children: [
            "评论基础模式加载失败，请",
            ' ',
            /*#__PURE__*/ jsx(DisqusJSRetryButton, {
                children: "重载"
            }),
            ' ',
            "或",
            ' ',
            /*#__PURE__*/ jsx(DisqusJSReTestModeButton, {
                children: "尝试完整 Disqus 模式"
            })
        ]
    }));
const DisqusJSCreateThread = /*#__PURE__*/ memo(()=>/*#__PURE__*/ jsxs("div", {
        id: "dsqjs-msg",
        children: [
            "当前 Thread 尚未创建。是否切换至",
            ' ',
            /*#__PURE__*/ jsx(DisqusJSForceDisqusModeButton, {
                children: "完整 Disqus 模式"
            }),
            "？"
        ]
    }));
const DisqusJSNoComment = /*#__PURE__*/ memo(({ text })=>/*#__PURE__*/ jsx("p", {
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

const ConfigContext = createContext(null);
const ConfigProvider = ConfigContext.Provider;
function useConfig() {
    const config = useContext(ConfigContext);
    if (!config) {
        throw new TypeError('<ConfigProvider /> is missing');
    }
    return config;
}

function DisqusJSPostItem({ comment, children, nesting }) {
    const { admin, adminLabel } = useConfig();
    const profileUrl = comment.author.profileUrl;
    const avatarUrl = processCommentMessage(comment.author.avatar.cache);
    const imgEl = /*#__PURE__*/ jsx("img", {
        alt: comment.author.username,
        src: avatarUrl
    });
    return /*#__PURE__*/ jsxs("li", {
        id: `comment-${comment.id}`,
        children: [
            /*#__PURE__*/ jsxs("div", {
                className: "dsqjs-post-item dsqjs-clearfix",
                children: [
                    /*#__PURE__*/ jsx("div", {
                        className: "dsqjs-post-avatar",
                        children: profileUrl ? /*#__PURE__*/ jsx("a", {
                            href: profileUrl,
                            target: "_blank",
                            rel: "noreferrer noopenner nofollow external",
                            children: imgEl
                        }) : imgEl
                    }),
                    /*#__PURE__*/ jsxs("div", {
                        className: "dsqjs-post-body",
                        children: [
                            /*#__PURE__*/ jsxs("div", {
                                className: "dsqjs-post-header",
                                children: [
                                    profileUrl ? /*#__PURE__*/ jsx("span", {
                                        className: "dsqjs-post-author",
                                        children: /*#__PURE__*/ jsx("a", {
                                            href: profileUrl,
                                            target: "_blank",
                                            rel: "noreferrer noopenner nofollow external",
                                            children: comment.author.name
                                        })
                                    }) : /*#__PURE__*/ jsx("span", {
                                        className: "dsqjs-post-author",
                                        children: comment.author.name
                                    }),
                                    // authorEl admin label
                                    admin === comment.author.username && /*#__PURE__*/ jsx("span", {
                                        className: "dsqjs-admin-badge",
                                        children: adminLabel
                                    }),
                                    ' ',
                                    /*#__PURE__*/ jsx("span", {
                                        className: "dsqjs-bullet"
                                    }),
                                    ' ',
                                    comment.createdAt && /*#__PURE__*/ jsx("span", {
                                        className: "dsqjs-meta",
                                        children: /*#__PURE__*/ jsx("time", {
                                            children: formatDate(comment.createdAt)
                                        })
                                    })
                                ]
                            }),
                            comment.isDeleted ? /*#__PURE__*/ jsx("div", {
                                className: "dsqjs-post-content",
                                children: /*#__PURE__*/ jsx("small", {
                                    children: "此评论已被删除"
                                })
                            }) : /*#__PURE__*/ jsx("div", {
                                className: "dsqjs-post-content",
                                dangerouslySetInnerHTML: {
                                    __html: processCommentMessage(comment.message)
                                }
                            })
                        ]
                    })
                ]
            }),
            /*#__PURE__*/ jsx(DisqusJSChildrenPostItems, {
                nesting: nesting,
                children: children
            }),
            comment.hasMore && /*#__PURE__*/ jsxs("p", {
                className: "dsqjs-has-more",
                children: [
                    "切换至 ",
                    /*#__PURE__*/ jsx(DisqusJSForceDisqusModeButton, {
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
    return /*#__PURE__*/ jsx("ul", {
        className: `dsqjs-post-list ${currentNesting < nestingSetting ? 'dsqjs-children' : ''}`,
        children: children.map((comment)=>/*#__PURE__*/ createElement(DisqusJSPostItem, {
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
    const processedComments = useMemo(()=>{
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
    return /*#__PURE__*/ jsx("ul", {
        className: "dsqjs-post-list",
        id: "dsqjs-post-container",
        children: processedComments.map((comment)=>/*#__PURE__*/ createElement(DisqusJSPostItem, {
                ...comment,
                key: comment.comment.id
            }))
    });
}

// We will try to make the used api key as stable as possible
// And if React decides to forget some memoized values, it doesn't matter anyway
function useRandomApiKey(apiKeys) {
    return useMemo(()=>{
        if (Array.isArray(apiKeys)) {
            return pickOne(apiKeys);
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
const [SortTypeProvider, useSortType, useSetSortType] = createContextState(getDisqusJsSortTypeDefaultValue());

function DisqusJSSortTypeRadio({ sortType, onChange, checked, title, label }) {
    return /*#__PURE__*/ jsxs(Fragment, {
        children: [
            /*#__PURE__*/ jsx("input", {
                className: "dsqjs-order-radio",
                id: `dsqjs-order-${sortType}`,
                type: "radio",
                name: "comment-order",
                value: sortType,
                onChange: onChange,
                checked: checked
            }),
            /*#__PURE__*/ jsx("label", {
                className: "dsqjs-order-label",
                htmlFor: `dsqjs-order-${sortType}`,
                title: title,
                children: label
            })
        ]
    });
}
const DisqusJSSortTypeRadioGroup = /*#__PURE__*/ memo(()=>{
    const sortType = useSortType();
    const setSortType = useSetSortType();
    return /*#__PURE__*/ jsxs("div", {
        className: "dsqjs-order",
        children: [
            /*#__PURE__*/ jsx(DisqusJSSortTypeRadio, {
                checked: sortType === 'desc' || sortType === null,
                sortType: "desc",
                title: "按从新到旧",
                label: "最新",
                onChange: useCallback(()=>setSortType('desc'), [
                    setSortType
                ])
            }),
            /*#__PURE__*/ jsx(DisqusJSSortTypeRadio, {
                checked: sortType === 'asc',
                sortType: "asc",
                title: "按从旧到新",
                label: "最早",
                onChange: useCallback(()=>setSortType('asc'), [
                    setSortType
                ])
            }),
            /*#__PURE__*/ jsx(DisqusJSSortTypeRadio, {
                checked: sortType === 'popular',
                sortType: "popular",
                title: "按评分从高到低",
                label: "最佳",
                onChange: useCallback(()=>setSortType('popular'), [
                    setSortType
                ])
            })
        ]
    });
});
if (process.env.NODE_ENV !== 'production') {
    DisqusJSSortTypeRadioGroup.displayName = 'DisqusJSSortTypeRadio';
}
const DisqusJSHeader = /*#__PURE__*/ memo(({ totalComments, siteName })=>/*#__PURE__*/ jsx("header", {
        className: "dsqjs-header",
        id: "dsqjs-header",
        children: /*#__PURE__*/ jsxs("nav", {
            className: "dsqjs-nav dsqjs-clearfix",
            children: [
                /*#__PURE__*/ jsxs("ul", {
                    children: [
                        /*#__PURE__*/ jsx("li", {
                            className: "dsqjs-nav-tab dsqjs-tab-active",
                            children: /*#__PURE__*/ jsxs("span", {
                                children: [
                                    totalComments,
                                    " Comments"
                                ]
                            })
                        }),
                        /*#__PURE__*/ jsx("li", {
                            className: "dsqjs-nav-tab",
                            children: siteName
                        })
                    ]
                }),
                /*#__PURE__*/ jsx(DisqusJSSortTypeRadioGroup, {})
            ]
        })
    }));
if (process.env.NODE_ENV !== 'production') {
    DisqusJSHeader.displayName = 'DisqusJSHeader';
}
function DisqusJSPosts({ id }) {
    const { apikey, shortname, api } = useConfig();
    const apiKey = useRef(useRandomApiKey(apikey));
    const [posts, setPosts] = useState([]);
    const setError = useSetHasError();
    const sortType = useSortType();
    const [isLoadingMorePosts, setIsLoadingMorePosts] = useState(false);
    const [errorWhenLoadingMorePosts, setErrorWhenLoadingMorePosts] = useState(false);
    const fetchMorePosts = useCallback(async (reset = false)=>{
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
    const resetAndFetchFirstPageOfPosts = useCallback(()=>fetchMorePosts(true), [
        fetchMorePosts
    ]);
    const fetchNextPageOfPosts = useCallback(()=>fetchMorePosts(false), [
        fetchMorePosts
    ]);
    useComponentWillReceiveUpdate(resetAndFetchFirstPageOfPosts, [
        id,
        sortType
    ]);
    useSingleton(resetAndFetchFirstPageOfPosts);
    const comments = useMemo(()=>posts.filter(Boolean).flatMap((i)=>i.response), [
        posts
    ]);
    if (posts.length > 0) {
        return /*#__PURE__*/ jsxs(Fragment, {
            children: [
                /*#__PURE__*/ jsx(DisqusJSCommentsList, {
                    comments: comments
                }),
                posts[posts.length - 1]?.cursor.hasNext && /*#__PURE__*/ jsx(DisqusJSLoadMoreCommentsButton, {
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
    const apiKey = useRef(useRandomApiKey($apikey));
    const [thread, setThread] = useState(null);
    const setError = useSetHasError();
    const identifier = typeof window === 'undefined' ? $identifier ?? null : $identifier ?? document.location.origin + document.location.pathname + document.location.search;
    const fetchThread = useCallback(async ()=>{
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
    const fetchThreadRef = useRef(null);
    useEffect(()=>{
        const actionElement = /*#__PURE__*/ jsxs(Fragment, {
            children: [
                /*#__PURE__*/ jsx(DisqusJSReTestModeButton, {
                    children: "尝试完整 Disqus 模式"
                }),
                " | ",
                /*#__PURE__*/ jsx(DisqusJSForceDisqusModeButton, {
                    children: "强制完整 Disqus 模式"
                })
            ]
        });
        if (fetchThreadRef.current === identifier) {
            setMsg(/*#__PURE__*/ jsxs(Fragment, {
                children: [
                    "你可能无法访问 Disqus，已启用评论基础模式。如需完整体验请针对 disq.us | disquscdn.com | disqus.com 启用代理并",
                    ' ',
                    actionElement
                ]
            }));
        } else {
            setMsg(/*#__PURE__*/ jsxs(Fragment, {
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
        return /*#__PURE__*/ jsx(DisqusJSCreateThread, {});
    }
    const matchedThread = thread.response[0];
    const totalComments = matchedThread.posts;
    return /*#__PURE__*/ jsxs(Fragment, {
        children: [
            /*#__PURE__*/ jsx(DisqusJSHeader, {
                totalComments: totalComments,
                siteName: siteName ?? ''
            }),
            totalComments === 0 ? /*#__PURE__*/ jsx(DisqusJSNoComment, {
                text: nocomment ?? '这里空荡荡的，一个人都没有'
            }) : /*#__PURE__*/ jsx(DisqusJSPosts, {
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
    useEffect$1((signal)=>{
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
        return /*#__PURE__*/ jsx(DisqusJSError, {});
    }
    return /*#__PURE__*/ jsxs(Fragment, {
        children: [
            msg != null && /*#__PURE__*/ jsx("div", {
                id: "dsqjs-msg",
                children: msg
            }),
            mode === 'disqus' && /*#__PURE__*/ jsx(Disqus, {
                shortname: shortname,
                identifier: identifier,
                url: url,
                title: title
            }),
            mode === 'dsqjs' && /*#__PURE__*/ jsx(DisqusJSThread, {})
        ]
    });
}

const DisqusJS = /*#__PURE__*/ forwardRef(({ shortname, siteName, identifier, url, title, api, apikey, nesting, nocomment, admin, adminLabel, className, ...rest }, ref)=>{
    const contexts = useMemo(()=>[
            /*#__PURE__*/ jsx(ConfigProvider, {
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
            /*#__PURE__*/ jsx(ModeProvider, {}, "mode"),
            /*#__PURE__*/ jsx(SortTypeProvider, {}, "sortType"),
            /*#__PURE__*/ jsx(HasErrorProvider, {}, "hasError"),
            /*#__PURE__*/ jsx(MessageProvider, {}, "msg")
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
    if (useIsClient()) {
        return /*#__PURE__*/ jsx("div", {
            ref: ref,
            ...rest,
            className: `${styles.dsqjs} ${className ?? ''}`,
            children: /*#__PURE__*/ jsx(ComposeContextProvider, {
                contexts: contexts,
                children: /*#__PURE__*/ jsxs("section", {
                    id: "dsqjs",
                    children: [
                        /*#__PURE__*/ jsx(DisqusJSEntry, {}),
                        /*#__PURE__*/ jsx(DisqusJSFooter, {})
                    ]
                })
            })
        });
    }
    return null;
});

export { DisqusJS };
