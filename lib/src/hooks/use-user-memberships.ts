import { useState, useEffect, useMemo, useCallback } from "react";
import { ChannelMetadataObject, ObjectCustom, GetMembershipsParametersv2 } from "pubnub";
import { usePubNub } from "pubnub-react";
import merge from "lodash.merge";
import cloneDeep from "lodash.clonedeep";

type HookReturnValue = [
  ChannelMetadataObject<ObjectCustom>[],
  () => Promise<void>,
  () => void,
  number,
  Error
];

export const useUserMemberships = (options: GetMembershipsParametersv2 = {}): HookReturnValue => {
  const jsonOptions = JSON.stringify(options);

  const pubnub = usePubNub();
  const [channels, setChannels] = useState<ChannelMetadataObject<ObjectCustom>[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState("");
  const [error, setError] = useState<Error>();
  const [doFetch, setDoFetch] = useState(true);

  const paginatedOptions = useMemo(
    () =>
      merge({}, JSON.parse(jsonOptions), {
        page: { next: page },
        include: { totalCount: true },
      }) as GetMembershipsParametersv2,
    [page, jsonOptions]
  );

  const resetHook = () => {
    setChannels([]);
    setTotalCount(0);
    setPage("");
    setError(undefined);
    setDoFetch(true);
  };

  const fetchPage = useCallback(async () => {
    setDoFetch(false);
    try {
      if (totalCount && channels.length >= totalCount) return;
      const response = await pubnub.objects.getMemberships(paginatedOptions);
      setChannels((channels) => [
        ...channels,
        ...(response.data.map((m) => m.channel) as ChannelMetadataObject<ObjectCustom>[]),
      ]);
      setTotalCount(response.totalCount);
      setPage(response.next);
    } catch (e) {
      setError(e);
    }
  }, [pubnub, paginatedOptions, channels.length, totalCount]);

  const handleObject = (event) => {
    const message = event.message;
    if (message.type !== "membership") return;

    setChannels((channels) => {
      const channelsCopy = cloneDeep(channels);
      const channel = channelsCopy.find((u) => u.id === message.data.channel.id);

      // Set events are not handled since there are no events fired for data updates
      // New memberships are not handled in order to conform to filters and pagination

      if (channel && message.event === "delete") {
        channelsCopy.splice(channelsCopy.indexOf(channel), 1);
      }

      return channelsCopy;
    });
  };

  useEffect(() => {
    pubnub.addListener({ objects: handleObject });
  }, [pubnub]);

  useEffect(() => {
    resetHook();
  }, [jsonOptions]);

  useEffect(() => {
    if (doFetch) fetchPage();
  }, [doFetch, fetchPage]);

  return [channels, fetchPage, resetHook, totalCount, error];
};
